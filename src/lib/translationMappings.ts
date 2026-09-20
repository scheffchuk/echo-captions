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
};

export type MappingPolicyResult =
	| { ok: true; mappings: StoredTranslationMapping[] }
	| { ok: false; issue: MappingPolicyIssue };

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

export function mappingKey(mapping: StoredTranslationMapping): string {
	return `${normalizeLanguageCode(mapping.targetLanguage)}\u0000${folded(mapping.term.trim().normalize("NFC"))}`;
}

function policyFailure(
	code: MappingPolicyIssueCode,
	message: string,
	index?: number,
): MappingPolicyResult {
	return { ok: false, issue: { code, message, index } };
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
	if (mappings.length > MAX_TRANSLATION_MAPPINGS) {
		return policyFailure(
			"too_many_mappings",
			`At most ${MAX_TRANSLATION_MAPPINGS} translation mappings are allowed`,
		);
	}

	const audienceSet = new Set(
		audienceLanguages.map((language) => normalizeLanguageCode(language)),
	);
	const seen = new Set<string>();
	const canonical: StoredTranslationMapping[] = [];

	for (const [index, rawMapping] of mappings.entries()) {
		const mapping = normalizeTranslationMapping(rawMapping);

		if (!mapping.term && !mapping.targetLanguage && !mapping.translation) {
			continue;
		}
		if (!mapping.term || !mapping.targetLanguage || !mapping.translation) {
			return policyFailure(
				"incomplete_mapping",
				"Each translation mapping needs a term, target language, and replacement",
				index,
			);
		}
		if (!audienceSet.has(mapping.targetLanguage)) {
			return policyFailure(
				"invalid_audience_language",
				`Mapping target language is not an Audience language: ${mapping.targetLanguage}`,
				index,
			);
		}
		if (characterCount(mapping.term) > MAX_MAPPING_VALUE_CHARS) {
			return policyFailure(
				"term_too_long",
				`Mapping terms may contain at most ${MAX_MAPPING_VALUE_CHARS} Unicode characters`,
				index,
			);
		}
		if (characterCount(mapping.translation) > MAX_MAPPING_VALUE_CHARS) {
			return policyFailure(
				"translation_too_long",
				`Mapping replacements may contain at most ${MAX_MAPPING_VALUE_CHARS} Unicode characters`,
				index,
			);
		}

		const key = mappingKey(mapping);
		if (seen.has(key)) {
			return policyFailure(
				"duplicate_mapping",
				`Duplicate mapping for ${mapping.term} in ${mapping.targetLanguage}`,
				index,
			);
		}
		seen.add(key);
		canonical.push(mapping);
	}

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
		.map(normalizeTranslationMapping)
		.filter(
			(mapping) =>
				mapping.term || mapping.targetLanguage || mapping.translation,
		)
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
