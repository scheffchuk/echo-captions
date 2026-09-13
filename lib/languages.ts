export {
	COMMON_LANGUAGES,
	fromScribeCode,
	MAX_SPOKEN_LANGUAGES,
	normalizeLanguageCode,
} from "@/shared/languages";

import { COMMON_LANGUAGES, normalizeLanguageCode } from "@/shared/languages";

export type LanguagePair = [string] | [string, string];

export function getCommonLanguageName(code: string): string {
	return COMMON_LANGUAGES.find((lang) => lang.code === code)?.name ?? code;
}

export function matchBrowserLocale(
	navigatorLanguage: string,
	audienceLanguages: string[],
): string | undefined {
	const locale = normalizeLanguageCode(navigatorLanguage);
	if (!locale) return undefined;

	for (const code of audienceLanguages) {
		if (locale === code) {
			return code;
		}
	}
}

/** Single language for audience viewers (browser locale, else first). */
export function defaultAudienceLanguage(audienceLanguages: string[]): [string] {
	if (audienceLanguages.length === 0) {
		return ["en"];
	}

	const matched =
		typeof navigator !== "undefined"
			? matchBrowserLocale(navigator.language, audienceLanguages)
			: undefined;

	return [matched ?? audienceLanguages[0]];
}

/** Operator preview default: primary + a second language when available. */
export function defaultLanguagePair(audienceLanguages: string[]): LanguagePair {
	const [langA] = defaultAudienceLanguage(audienceLanguages);

	if (audienceLanguages.length <= 1) {
		return [langA];
	}

	const langB =
		audienceLanguages.find((code) => code !== langA) ?? audienceLanguages[1];

	return [langA, langB];
}

export function formatLanguagePairLabel(pair: [string, string]): string {
	return `${getCommonLanguageName(pair[0])} · ${getCommonLanguageName(pair[1])}`;
}

export function formatLanguagePairLabelCompact(pair: [string, string]): string {
	return `${pair[0].toUpperCase()} · ${pair[1].toUpperCase()}`;
}

export function formatLanguageLabelCompact(code: string): string {
	return code.toUpperCase();
}

export function segmentFontFamily(code: string) {
	return code === "en"
		? "var(--font-geist-sans), system-ui, sans-serif"
		: "var(--font-geist-sans), 'Noto Sans CJK SC', 'Noto Sans CJK JP', system-ui, sans-serif";
}
