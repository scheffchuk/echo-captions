import { normalizeLanguageCode } from "../../shared/languages";

export type StoredTranslationMapping = {
	term: string;
	targetLanguage: string;
	translation: string;
};

export const MAX_TRANSLATION_MAPPINGS = 100;

export const MAX_MAPPING_VALUE_CHARS = 200;

export type MappingPolicyIssueCode =
	| "too_many_mappings"
	| "incomplete_mapping"
	| "invalid_audience_language"
	| "term_too_long"
	| "translation_too_long"
	| "duplicate_mapping";

export type MappingPolicyIssue = {
	code: MappingPolicyIssueCode;
	message: string;
	index?: number;
	field?: keyof StoredTranslationMapping;
};

export type MappingPolicyResult =
	| { ok: true; mappings: StoredTranslationMapping[] }
	| { ok: false; issues: MappingPolicyIssue[] };

export function normalizeTranslationMapping(
	mapping: StoredTranslationMapping,
): StoredTranslationMapping {
	return {
		term: mapping.term.trim().normalize("NFC"),
		targetLanguage: normalizeLanguageCode(mapping.targetLanguage),
		translation: mapping.translation.trim().normalize("NFC"),
	};
}

function folded(value: string): string {
	return value.toLowerCase();
}

function characterCount(value: string): number {
	return Array.from(value).length;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedMappingKey(mapping: StoredTranslationMapping): string {
	return `${mapping.targetLanguage}\u0000${folded(mapping.term)}`;
}

function mappingIsBlank(mapping: StoredTranslationMapping): boolean {
	return !mapping.term && !mapping.targetLanguage && !mapping.translation;
}

/**
 * Return the canonical representation stored in a Mapping revision.
 * Blank rows are useful while editing in the browser and are discarded; a
 * partially filled row is rejected so it can never become an implicit rule.
 */
export function canonicalizeTranslationMappings(
	mappings: ReadonlyArray<StoredTranslationMapping>,
	audienceLanguages: ReadonlyArray<string>,
): MappingPolicyResult {
	const normalizedMappings = mappings.map(normalizeTranslationMapping);

	const issues: MappingPolicyIssue[] =
		normalizedMappings.filter((mapping) => !mappingIsBlank(mapping)).length >
		MAX_TRANSLATION_MAPPINGS
			? [
					{
						code: "too_many_mappings",
						message: `At most ${MAX_TRANSLATION_MAPPINGS} translation mappings are allowed`,
					},
				]
			: [];

	const audienceSet = new Set(
		audienceLanguages.map((language) => normalizeLanguageCode(language)),
	);

	const seen = new Set<string>();
	const canonical: StoredTranslationMapping[] = [];

	for (const [index, mapping] of normalizedMappings.entries()) {
		if (mappingIsBlank(mapping)) {
			continue;
		}

		if (!mapping.term || !mapping.targetLanguage || !mapping.translation) {
			issues.push({
				code: "incomplete_mapping",
				message:
					"Each translation mapping needs a term, target language, and replacement",
				index,
				field: !mapping.term
					? "term"
					: !mapping.targetLanguage
						? "targetLanguage"
						: "translation",
			});
			continue;
		}

		let hasRowIssue = false;

		if (!audienceSet.has(mapping.targetLanguage)) {
			issues.push({
				code: "invalid_audience_language",
				message: `Mapping target language is not an Audience language: ${mapping.targetLanguage}`,
				index,
				field: "targetLanguage",
			});
			hasRowIssue = true;
		}

		if (characterCount(mapping.term) > MAX_MAPPING_VALUE_CHARS) {
			issues.push({
				code: "term_too_long",
				message: `Mapping terms may contain at most ${MAX_MAPPING_VALUE_CHARS} Unicode characters`,
				index,
				field: "term",
			});
			hasRowIssue = true;
		}

		if (characterCount(mapping.translation) > MAX_MAPPING_VALUE_CHARS) {
			issues.push({
				code: "translation_too_long",
				message: `Mapping replacements may contain at most ${MAX_MAPPING_VALUE_CHARS} Unicode characters`,
				index,
				field: "translation",
			});
			hasRowIssue = true;
		}

		const key = normalizedMappingKey(mapping);

		if (seen.has(key)) {
			issues.push({
				code: "duplicate_mapping",
				message: `Duplicate mapping for ${mapping.term} in ${mapping.targetLanguage}`,
				index,
				field: "term",
			});
			hasRowIssue = true;
		}

		seen.add(key);

		if (!hasRowIssue) canonical.push(mapping);
	}

	if (issues.length > 0) return { ok: false, issues };

	canonical.sort(
		(left, right) =>
			compareStrings(left.targetLanguage, right.targetLanguage) ||
			compareStrings(folded(left.term), folded(right.term)) ||
			compareStrings(left.term, right.term),
	);

	return { ok: true, mappings: canonical };
}

function comparableMappings(
	mappings: ReadonlyArray<StoredTranslationMapping>,
): StoredTranslationMapping[] {
	return mappings
		.flatMap((mapping) => {
			const normalized = normalizeTranslationMapping(mapping);

			return normalized.term ||
				normalized.targetLanguage ||
				normalized.translation
				? [normalized]
				: [];
		})
		.sort(
			(left, right) =>
				compareStrings(left.targetLanguage, right.targetLanguage) ||
				compareStrings(folded(left.term), folded(right.term)) ||
				compareStrings(left.term, right.term) ||
				compareStrings(left.translation, right.translation),
		);
}

export function canonicalTranslationMappingsEqual(
	left: ReadonlyArray<StoredTranslationMapping>,
	right: ReadonlyArray<StoredTranslationMapping>,
): boolean {
	const leftComparable = comparableMappings(left);
	const rightComparable = comparableMappings(right);

	return (
		leftComparable.length === rightComparable.length &&
		leftComparable.every(
			(mapping, index) =>
				mapping.term === rightComparable[index]?.term &&
				mapping.targetLanguage === rightComparable[index]?.targetLanguage &&
				mapping.translation === rightComparable[index]?.translation,
		)
	);
}

export function filterMappingsForAudience(
	mappings: ReadonlyArray<StoredTranslationMapping>,
	audienceLanguages: ReadonlyArray<string>,
): StoredTranslationMapping[] {
	const audienceSet = new Set(
		audienceLanguages.map((language) => normalizeLanguageCode(language)),
	);

	return mappings.filter((mapping) =>
		audienceSet.has(normalizeLanguageCode(mapping.targetLanguage)),
	);
}
