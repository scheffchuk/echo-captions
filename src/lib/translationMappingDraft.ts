import { Match } from "effect";
import type { Id } from "@/convex/_generated/dataModel";
import { normalizeLanguageCode } from "../../shared/languages";
import {
	canonicalizeTranslationMappings,
	canonicalTranslationMappingsEqual,
	type MappingPolicyIssue,
	normalizeTranslationMapping,
	type StoredTranslationMapping,
} from "./translationMappings";

export type TranslationMappingDraftRow = StoredTranslationMapping & {
	id: string;
};

export type TranslationMappingDraftField = keyof StoredTranslationMapping;

export type TranslationMappingDraftIssueCode =
	| "too_many_mappings"
	| "incomplete_row"
	| "invalid_audience_language"
	| "term_too_long"
	| "translation_too_long"
	| "duplicate_mapping"
	| "conflict";

export type TranslationMappingDraftIssue = {
	rowId: string;
	field: TranslationMappingDraftField;
	code: TranslationMappingDraftIssueCode;
};

export type TranslationMappingDraft = {
	rows: TranslationMappingDraftRow[];
	baseRevisionId: Id<"translationMappingRevisions"> | null;
	baseMappings: StoredTranslationMapping[];
	conflict: boolean;
};

export type TranslationMappingIdFactory = () => string;

export type TranslationMappingDraftProjection =
	| { ok: true; mappings: StoredTranslationMapping[] }
	| { ok: false; issues: TranslationMappingDraftIssue[] };

const DRAFT_ISSUE_ROW = "$draft";

export function createTranslationMappingDraft({
	rows = [],
	baseRevisionId = null,
	baseMappings = [],
}: {
	rows?: ReadonlyArray<TranslationMappingDraftRow>;
	baseRevisionId?: Id<"translationMappingRevisions"> | null;
	baseMappings?: ReadonlyArray<StoredTranslationMapping>;
} = {}): TranslationMappingDraft {
	return {
		rows: [...rows],
		baseRevisionId,
		baseMappings: [...baseMappings],
		conflict: false,
	};
}

export function hydrateTranslationMappingDraft(
	mappings: ReadonlyArray<StoredTranslationMapping> | undefined,
	baseRevisionId: Id<"translationMappingRevisions"> | null | undefined,
	idFactory: TranslationMappingIdFactory,
): TranslationMappingDraft {
	const savedMappings = [...(mappings ?? [])];

	return createTranslationMappingDraft({
		rows: savedMappings.map((mapping) => ({ ...mapping, id: idFactory() })),
		baseRevisionId: baseRevisionId ?? null,
		baseMappings: savedMappings,
	});
}

export function addTranslationMappingDraftRow(
	draft: TranslationMappingDraft,
	idFactory: TranslationMappingIdFactory,
): TranslationMappingDraft {
	return {
		...draft,
		rows: [
			...draft.rows,
			{ id: idFactory(), term: "", targetLanguage: "", translation: "" },
		],
	};
}

export function updateTranslationMappingDraftRow(
	draft: TranslationMappingDraft,
	rowId: string,
	patch: Partial<StoredTranslationMapping>,
): TranslationMappingDraft {
	return {
		...draft,
		rows: draft.rows.map((row) =>
			row.id === rowId ? { ...row, ...patch } : row,
		),
	};
}

export function removeTranslationMappingDraftRow(
	draft: TranslationMappingDraft,
	rowId: string,
): TranslationMappingDraft {
	return {
		...draft,
		rows: draft.rows.filter((row) => row.id !== rowId),
	};
}

function issue(
	rowId: string,
	field: TranslationMappingDraftField,
	code: TranslationMappingDraftIssueCode,
): TranslationMappingDraftIssue {
	return { rowId, field, code };
}

function rowIsBlank(row: StoredTranslationMapping): boolean {
	return (
		!row.term.trim() && !row.targetLanguage.trim() && !row.translation.trim()
	);
}

function issueFromPolicy(
	rows: ReadonlyArray<TranslationMappingDraftRow>,
	policyIssue: MappingPolicyIssue,
): TranslationMappingDraftIssue {
	const rowId =
		policyIssue.index === undefined
			? DRAFT_ISSUE_ROW
			: (rows[policyIssue.index]?.id ?? DRAFT_ISSUE_ROW);

	const code =
		policyIssue.code === "incomplete_mapping"
			? "incomplete_row"
			: policyIssue.code;

	const field = Match.value(code).pipe(
		Match.when("translation_too_long", () => "translation" as const),
		Match.when("invalid_audience_language", () => "targetLanguage" as const),
		Match.orElse(() => policyIssue.field ?? "term"),
	);

	return issue(rowId, field, code);
}

function contentForComparison(
	rows: ReadonlyArray<TranslationMappingDraftRow>,
): StoredTranslationMapping[] {
	return rows.flatMap((row) =>
		rowIsBlank(row) ? [] : [normalizeTranslationMapping(row)],
	);
}

function mappingsMatch(
	left: StoredTranslationMapping,
	right: StoredTranslationMapping,
): boolean {
	const normalizedLeft = normalizeTranslationMapping(left);
	const normalizedRight = normalizeTranslationMapping(right);

	return (
		normalizedLeft.term === normalizedRight.term &&
		normalizedLeft.targetLanguage === normalizedRight.targetLanguage &&
		normalizedLeft.translation === normalizedRight.translation
	);
}

export function isTranslationMappingDraftDirty(
	draft: TranslationMappingDraft,
	audienceCodes?: ReadonlyArray<string>,
	projection?: TranslationMappingDraftProjection,
): boolean {
	if (draft.conflict) return true;

	if (audienceCodes !== undefined) {
		const projected =
			projection ?? projectTranslationMappingDraft(draft, audienceCodes);

		if (!projected.ok) return true;
	}

	return !canonicalTranslationMappingsEqual(
		contentForComparison(draft.rows),
		draft.baseMappings,
	);
}

export function projectTranslationMappingDraft(
	draft: TranslationMappingDraft,
	audienceCodes: ReadonlyArray<string>,
): TranslationMappingDraftProjection {
	const result = canonicalizeTranslationMappings(
		draft.rows.map(({ id: _id, ...mapping }) => mapping),
		audienceCodes,
	);

	if (!result.ok) {
		const issues = result.issues.map((policyIssue) =>
			issueFromPolicy(draft.rows, policyIssue),
		);

		if (draft.conflict) issues.push(issue(DRAFT_ISSUE_ROW, "term", "conflict"));

		return { ok: false, issues };
	}

	if (draft.conflict) {
		return {
			ok: false,
			issues: [issue(DRAFT_ISSUE_ROW, "term", "conflict")],
		};
	}

	return { ok: true, mappings: result.mappings };
}

export function reconcileTranslationMappingDraft(
	draft: TranslationMappingDraft,
	latestMappings: ReadonlyArray<StoredTranslationMapping> | undefined,
	latestRevisionId: Id<"translationMappingRevisions"> | null | undefined,
	idFactory: TranslationMappingIdFactory,
	audienceCodes?: ReadonlyArray<string>,
): TranslationMappingDraft {
	const normalizedRevisionId = latestRevisionId ?? null;

	if (draft.baseRevisionId === normalizedRevisionId) return draft;

	if (isTranslationMappingDraftDirty(draft)) {
		return { ...draft, conflict: true };
	}

	const latest = [...(latestMappings ?? [])];
	const audience = new Set((audienceCodes ?? []).map(normalizeLanguageCode));

	const retainedAudienceRows = audienceCodes
		? draft.baseMappings.filter(
				(mapping) =>
					!audience.has(normalizeTranslationMapping(mapping).targetLanguage) &&
					!latest.some((candidate) => mappingsMatch(mapping, candidate)),
			)
		: [];

	const next = hydrateTranslationMappingDraft(
		[...latest, ...retainedAudienceRows],
		normalizedRevisionId,
		idFactory,
	);

	return retainedAudienceRows.length === 0
		? next
		: { ...next, baseMappings: latest };
}

export function markTranslationMappingDraftConflict(
	draft: TranslationMappingDraft,
): TranslationMappingDraft {
	return { ...draft, conflict: true };
}
