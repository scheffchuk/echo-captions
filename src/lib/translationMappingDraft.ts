import { normalizeLanguageCode } from "../../shared/languages";
import {
	canonicalizeTranslationMappings,
	canonicalTranslationMappingsEqual,
	MAX_MAPPING_VALUE_CHARS,
	MAX_TRANSLATION_MAPPINGS,
	type MappingPolicyIssueCode,
	mappingKey,
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
	baseRevisionId: string | null;
	baseMappings: StoredTranslationMapping[];
	issues: TranslationMappingDraftIssue[];
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
	baseRevisionId?: string | null;
	baseMappings?: ReadonlyArray<StoredTranslationMapping>;
} = {}): TranslationMappingDraft {
	return {
		rows: [...rows],
		baseRevisionId,
		baseMappings: [...baseMappings],
		issues: [],
		conflict: false,
	};
}

export function hydrateTranslationMappingDraft(
	mappings: ReadonlyArray<StoredTranslationMapping> | undefined,
	baseRevisionId: string | null | undefined,
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
		issues: [],
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
		issues: [],
	};
}

export function removeTranslationMappingDraftRow(
	draft: TranslationMappingDraft,
	rowId: string,
): TranslationMappingDraft {
	return {
		...draft,
		rows: draft.rows.filter((row) => row.id !== rowId),
		issues: [],
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
	policyCode: MappingPolicyIssueCode,
	index: number | undefined,
): TranslationMappingDraftIssue {
	const rowId =
		index === undefined
			? DRAFT_ISSUE_ROW
			: (rows[index]?.id ?? DRAFT_ISSUE_ROW);
	const code =
		policyCode === "incomplete_mapping" ? "incomplete_row" : policyCode;
	const field =
		code === "translation_too_long"
			? "translation"
			: code === "invalid_audience_language"
				? "targetLanguage"
				: "term";
	return issue(rowId, field, code);
}

export function validateTranslationMappingDraft(
	draft: TranslationMappingDraft,
	audienceCodes: ReadonlyArray<string>,
): TranslationMappingDraft {
	const issues: TranslationMappingDraftIssue[] = [];
	const audience = new Set(audienceCodes.map(normalizeLanguageCode));
	const seen = new Set<string>();
	const nonBlankRows = draft.rows.filter((row) => !rowIsBlank(row));

	if (nonBlankRows.length > MAX_TRANSLATION_MAPPINGS) {
		issues.push(issue(DRAFT_ISSUE_ROW, "term", "too_many_mappings"));
	}

	for (const row of draft.rows) {
		if (rowIsBlank(row)) continue;
		const mapping = normalizeTranslationMapping(row);
		if (!mapping.term || !mapping.targetLanguage || !mapping.translation) {
			const field = !mapping.term
				? "term"
				: !mapping.targetLanguage
					? "targetLanguage"
					: "translation";
			issues.push(issue(row.id, field, "incomplete_row"));
			continue;
		}
		if (!audience.has(mapping.targetLanguage)) {
			issues.push(issue(row.id, "targetLanguage", "invalid_audience_language"));
		}
		if (Array.from(mapping.term).length > MAX_MAPPING_VALUE_CHARS) {
			issues.push(issue(row.id, "term", "term_too_long"));
		}
		if (Array.from(mapping.translation).length > MAX_MAPPING_VALUE_CHARS) {
			issues.push(issue(row.id, "translation", "translation_too_long"));
		}
		const key = mappingKey(mapping);
		if (seen.has(key)) {
			issues.push(issue(row.id, "term", "duplicate_mapping"));
		} else {
			seen.add(key);
		}
	}

	if (draft.conflict) issues.push(issue(DRAFT_ISSUE_ROW, "term", "conflict"));
	return { ...draft, issues };
}

function contentForComparison(
	rows: ReadonlyArray<TranslationMappingDraftRow>,
): StoredTranslationMapping[] {
	return rows
		.filter((row) => !rowIsBlank(row))
		.map(normalizeTranslationMapping);
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
): boolean {
	if (draft.conflict) return true;
	if (audienceCodes !== undefined) {
		const validated = validateTranslationMappingDraft(draft, audienceCodes);
		if (validated.issues.length > 0) return true;
	}
	return !canonicalTranslationMappingsEqual(
		contentForComparison(draft.rows),
		draft.baseMappings,
	);
}

function projection(
	draft: TranslationMappingDraft,
	audienceCodes: ReadonlyArray<string>,
): TranslationMappingDraftProjection {
	const validated = validateTranslationMappingDraft(draft, audienceCodes);
	if (validated.issues.length > 0)
		return { ok: false, issues: validated.issues };

	const result = canonicalizeTranslationMappings(validated.rows, audienceCodes);
	if (!result.ok) {
		return {
			ok: false,
			issues: [
				issueFromPolicy(validated.rows, result.issue.code, result.issue.index),
			],
		};
	}
	return { ok: true, mappings: result.mappings };
}

export function toCreateInput(
	draft: TranslationMappingDraft,
	audienceCodes: ReadonlyArray<string>,
): TranslationMappingDraftProjection {
	return projection(draft, audienceCodes);
}

export function toUpdateInput(
	draft: TranslationMappingDraft,
	audienceCodes: ReadonlyArray<string>,
): TranslationMappingDraftProjection {
	return projection(draft, audienceCodes);
}

export function reconcileTranslationMappingDraft(
	draft: TranslationMappingDraft,
	latestMappings: ReadonlyArray<StoredTranslationMapping> | undefined,
	latestRevisionId: string | null | undefined,
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
