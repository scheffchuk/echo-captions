import type { Infer } from "convex/values";
import { Effect, Schema } from "effect";
import type { translationMappingValidator } from "../schema";
import { normalizeLanguageCode } from "./languages";

export type TranslationMapping = Infer<typeof translationMappingValidator>;

export const MAX_TRANSLATION_MAPPINGS = 100;
export const MAX_MAPPING_VALUE_CHARS = 200;

export class MappingValidationError extends Schema.TaggedError<MappingValidationError>()(
	"MappingValidationError",
	{ message: Schema.String },
) {}

export class MappingRevisionConflict extends Schema.TaggedError<MappingRevisionConflict>()(
	"MappingRevisionConflict",
	{ message: Schema.String },
) {}

/** A provider returned a fixed mapping occurrence that cannot be trusted. */
export class MappingIntegrityError extends Schema.TaggedError<MappingIntegrityError>()(
	"MappingIntegrityError",
	{ message: Schema.String },
) {}

export type FixedTranslationSpan = {
	kind: "fixed";
	id: string;
	sourceText: string;
	replacement: string;
};

export type TranslationTextSpan = {
	kind: "text";
	text: string;
};

export type TranslationDocument = {
	targetLanguage: string;
	spans: Array<TranslationTextSpan | FixedTranslationSpan>;
	fixedSpans: FixedTranslationSpan[];
};

function folded(value: string): string {
	return value.toLowerCase();
}

function characterCount(value: string): number {
	return Array.from(value).length;
}

function fail(message: string): Effect.Effect<never, MappingValidationError> {
	return Effect.fail(new MappingValidationError({ message }));
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Return the canonical representation stored in a Mapping revision.
 * Blank rows are useful while editing in the browser and are discarded; a
 * partially filled row is rejected so it can never become an implicit rule.
 */
export const canonicalizeTranslationMappings = Effect.fn(
	"TranslationMappings.canonicalize",
)(function* (
	mappings: ReadonlyArray<TranslationMapping>,
	audienceLanguages: ReadonlyArray<string>,
) {
	if (mappings.length > MAX_TRANSLATION_MAPPINGS) {
		return yield* fail(
			`At most ${MAX_TRANSLATION_MAPPINGS} translation mappings are allowed`,
		);
	}

	const audienceSet = new Set(
		audienceLanguages.map((language) => normalizeLanguageCode(language)),
	);
	const seen = new Set<string>();
	const canonical: TranslationMapping[] = [];

	for (const mapping of mappings) {
		const term = mapping.term.trim().normalize("NFC");
		const targetLanguage = normalizeLanguageCode(mapping.targetLanguage);
		const translation = mapping.translation.trim().normalize("NFC");

		if (!term && !mapping.targetLanguage.trim() && !translation) continue;
		if (!term || !targetLanguage || !translation) {
			return yield* fail(
				"Each translation mapping needs a term, target language, and replacement",
			);
		}
		if (!audienceSet.has(targetLanguage)) {
			return yield* fail(
				`Mapping target language is not an Audience language: ${targetLanguage}`,
			);
		}
		if (characterCount(term) > MAX_MAPPING_VALUE_CHARS) {
			return yield* fail(
				`Mapping terms may contain at most ${MAX_MAPPING_VALUE_CHARS} Unicode characters`,
			);
		}
		if (characterCount(translation) > MAX_MAPPING_VALUE_CHARS) {
			return yield* fail(
				`Mapping replacements may contain at most ${MAX_MAPPING_VALUE_CHARS} Unicode characters`,
			);
		}

		const key = `${targetLanguage}\u0000${folded(term)}`;
		if (seen.has(key)) {
			return yield* fail(`Duplicate mapping for ${term} in ${targetLanguage}`);
		}
		seen.add(key);
		canonical.push({ term, targetLanguage, translation });
	}

	canonical.sort(
		(left, right) =>
			compareStrings(left.targetLanguage, right.targetLanguage) ||
			compareStrings(folded(left.term), folded(right.term)) ||
			compareStrings(left.term, right.term),
	);
	return canonical;
});

export function canonicalTranslationMappingsEqual(
	left: ReadonlyArray<TranslationMapping>,
	right: ReadonlyArray<TranslationMapping>,
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(mapping, index) =>
				mapping.term === right[index]?.term &&
				mapping.targetLanguage === right[index]?.targetLanguage &&
				mapping.translation === right[index]?.translation,
		)
	);
}

export function filterMappingsForAudience(
	mappings: ReadonlyArray<TranslationMapping>,
	audienceLanguages: ReadonlyArray<string>,
): TranslationMapping[] {
	const audienceSet = new Set(
		audienceLanguages.map((language) => normalizeLanguageCode(language)),
	);
	return mappings.filter((mapping) =>
		audienceSet.has(normalizeLanguageCode(mapping.targetLanguage)),
	);
}

function isLetterOrNumber(value: string | undefined): boolean {
	return value !== undefined && /^[\p{L}\p{N}]$/u.test(value);
}

// These scripts commonly write words without spaces. Boundary checks would
// make a valid phrase inside a larger sentence impossible to protect.
function hasNoWordSeparators(value: string): boolean {
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
		value,
	);
}

type Candidate = {
	start: number;
	end: number;
	termLength: number;
	mappingIndex: number;
	mapping: TranslationMapping;
};

function findCandidates(
	text: string[],
	mapping: TranslationMapping,
	mappingIndex: number,
): Candidate[] {
	const term = Array.from(mapping.term);
	if (term.length === 0) return [];
	const foldedTerm = folded(mapping.term);
	const boundaryBased = !hasNoWordSeparators(mapping.term);
	const candidates: Candidate[] = [];

	for (let start = 0; start < text.length; start += 1) {
		let foldedCandidate = "";
		let end = start;
		while (end < text.length && foldedCandidate.length < foldedTerm.length) {
			foldedCandidate += folded(text[end] ?? "");
			end += 1;
		}
		if (foldedCandidate !== foldedTerm) continue;
		if (
			boundaryBased &&
			(isLetterOrNumber(text[start - 1]) || isLetterOrNumber(text[end]))
		) {
			continue;
		}
		candidates.push({
			start,
			end,
			termLength: term.length,
			mappingIndex,
			mapping,
		});
	}
	return candidates;
}

function overlaps(left: Candidate, right: Candidate): boolean {
	return left.start < right.end && right.start < left.end;
}

function selectMatches(
	text: string[],
	mappings: ReadonlyArray<TranslationMapping>,
): Candidate[] {
	const candidates = mappings.flatMap((mapping, mappingIndex) =>
		findCandidates(text, mapping, mappingIndex),
	);
	// Longest-first gives an overlapping span ownership of the source text.
	// Start and mapping order make equal-length choices deterministic.
	candidates.sort(
		(left, right) =>
			right.termLength - left.termLength ||
			left.start - right.start ||
			left.mappingIndex - right.mappingIndex,
	);

	const selected: Candidate[] = [];
	for (const candidate of candidates) {
		if (selected.some((other) => overlaps(candidate, other))) continue;
		selected.push(candidate);
	}
	return selected.sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

export function makeTranslationDocuments(
	sourceText: string,
	mappings: ReadonlyArray<TranslationMapping>,
	targetLanguages: ReadonlyArray<string>,
): TranslationDocument[] {
	const normalizedSource = sourceText.normalize("NFC");
	const sourceCharacters = Array.from(normalizedSource);

	return targetLanguages.map((rawTargetLanguage) => {
		const targetLanguage = normalizeLanguageCode(rawTargetLanguage);
		const targetMappings = mappings.filter(
			(mapping) =>
				normalizeLanguageCode(mapping.targetLanguage) === targetLanguage,
		);
		const matches = selectMatches(sourceCharacters, targetMappings);

		if (matches.length === 0) {
			return {
				targetLanguage,
				spans: [{ kind: "text" as const, text: normalizedSource }],
				fixedSpans: [],
			};
		}

		const spans: Array<TranslationTextSpan | FixedTranslationSpan> = [];
		const fixedSpans: FixedTranslationSpan[] = [];
		let previousEnd = 0;

		for (const [occurrenceIndex, match] of matches.entries()) {
			const before = sourceCharacters.slice(previousEnd, match.start).join("");
			if (before) {
				spans.push({ kind: "text", text: before });
			}

			const fixed: FixedTranslationSpan = {
				kind: "fixed",
				id: `mapping-${match.mappingIndex}-occurrence-${occurrenceIndex}`,
				sourceText: sourceCharacters.slice(match.start, match.end).join(""),
				replacement: match.mapping.translation,
			};
			spans.push(fixed);
			fixedSpans.push(fixed);
			previousEnd = match.end;
		}

		const after = sourceCharacters.slice(previousEnd).join("");
		if (after) {
			spans.push({ kind: "text", text: after });
		}

		return {
			targetLanguage,
			spans,
			fixedSpans,
		};
	});
}
