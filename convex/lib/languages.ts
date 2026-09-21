export {
	fromGoogleCode,
	fromScribeCode,
	isValidLanguageCode,
	MAX_SPOKEN_LANGUAGES,
	normalizeLanguageCode,
	toGoogleCode,
} from "../../shared/languages";

import { Schema } from "effect";
import {
	fromScribeCode,
	isValidLanguageCode,
	MAX_SPOKEN_LANGUAGES,
	normalizeLanguageCode,
} from "../../shared/languages";

export class InvalidLanguage extends Schema.TaggedError<InvalidLanguage>()(
	"InvalidLanguage",
	{ message: Schema.String },
) {}

export const languageErrorCodes = {
	InvalidLanguage: "invalid_language",
} as const;

export function normalizeLanguageList(codes: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of codes) {
		const code = normalizeLanguageCode(raw);
		if (!code || seen.has(code)) continue;
		seen.add(code);
		result.push(code);
	}
	return result;
}

export function computeAudienceLanguages(
	spokenLanguages: string[],
	audienceLanguagesExtra: string[] | undefined,
): string[] {
	return normalizeLanguageList([
		...spokenLanguages,
		...(audienceLanguagesExtra ?? []),
	]);
}

export function computeTranslationTargets(
	audienceLanguages: string[],
	sourceLanguage: string,
): string[] {
	const source = normalizeLanguageCode(sourceLanguage);
	return audienceLanguages.filter((lang) => lang !== source);
}

export function resolveSourceLanguage(
	detected: string | undefined,
	spokenLanguages: string[] | undefined,
): string {
	const spoken = normalizeLanguageList(spokenLanguages ?? []);
	const fallback = spoken[0] ?? "en";
	if (!detected?.trim()) return fallback;
	const normalized =
		fromScribeCode(detected) ?? normalizeLanguageCode(detected);
	if (spoken.length === 0) return normalized;
	if (spoken.includes(normalized)) return normalized;
	return fallback;
}

export function validateSpokenLanguages(spokenLanguages: string[]) {
	const normalized = normalizeLanguageList(spokenLanguages);
	if (normalized.length < 1) {
		throw new InvalidLanguage({ message: "Add at least one spoken language" });
	}
	if (normalized.length > MAX_SPOKEN_LANGUAGES) {
		throw new InvalidLanguage({
			message: `At most ${MAX_SPOKEN_LANGUAGES} spoken languages`,
		});
	}
	for (const code of normalized) {
		if (!isValidLanguageCode(code)) {
			throw new InvalidLanguage({
				message: `Unsupported language code: ${code}`,
			});
		}
	}
	return normalized;
}

export function validateAudienceLanguagesExtra(
	spokenLanguages: string[],
	extra: string[] | undefined,
) {
	const normalizedExtra = normalizeLanguageList(extra ?? []);
	for (const code of normalizedExtra) {
		if (!isValidLanguageCode(code)) {
			throw new InvalidLanguage({
				message: `Unsupported language code: ${code}`,
			});
		}
	}
	const audience = computeAudienceLanguages(spokenLanguages, normalizedExtra);
	if (audience.length < 1) {
		throw new InvalidLanguage({
			message: "Add at least one audience language",
		});
	}
	return normalizedExtra;
}
