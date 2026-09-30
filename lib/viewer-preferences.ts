import { Option, Schema } from "effect";
import {
	defaultAudienceLanguage,
	defaultLanguagePair,
	type LanguagePair,
} from "@/lib/languages";

const LANGUAGE_PAIR_PREFIX = "echo-viewer-langs:";

const TEXT_SIZE_KEY = "echo-viewer-text-size";

const languagePairSchema = Schema.fromJsonString(
	Schema.Union([
		Schema.Tuple([Schema.NonEmptyString]),
		Schema.Tuple([Schema.NonEmptyString, Schema.NonEmptyString]).check(
			Schema.makeFilter(([first, second]) =>
				first === second ? "languages must be different" : undefined,
			),
		),
	]),
);

const textSizeSchema = Schema.FiniteFromString.check(
	Schema.isBetween({ minimum: 0.8, maximum: 1.4 }),
);

function removeStoredLanguagePair(slug: string) {
	if (typeof window === "undefined") return;
	localStorage.removeItem(`${LANGUAGE_PAIR_PREFIX}${slug}`);
}

export function getStoredLanguagePair(slug: string): LanguagePair | null {
	if (typeof window === "undefined") return null;
	const key = `${LANGUAGE_PAIR_PREFIX}${slug}`;
	const stored = localStorage.getItem(key);

	if (stored === null) return null;

	const decoded = Option.getOrUndefined(
		Schema.decodeUnknownOption(languagePairSchema)(stored),
	);

	if (decoded) {
		return decoded.length === 1 ? [decoded[0]] : [decoded[0], decoded[1]];
	}

	localStorage.removeItem(key);

	return null;
}

export function setStoredLanguagePair(slug: string, pair: LanguagePair) {
	localStorage.setItem(`${LANGUAGE_PAIR_PREFIX}${slug}`, JSON.stringify(pair));
}

export function isLanguagePairAvailable(
	pair: LanguagePair,
	audienceLanguages: readonly string[],
): boolean {
	return (
		pair.every((code) => audienceLanguages.includes(code)) &&
		(pair.length === 1 || pair[0] !== pair[1])
	);
}

function storedPairForAudience(
	slug: string,
	audienceLanguages: readonly string[],
): LanguagePair | null {
	const stored = getStoredLanguagePair(slug);

	if (!stored) return null;

	if (isLanguagePairAvailable(stored, audienceLanguages)) return stored;
	removeStoredLanguagePair(slug);

	return null;
}

/** Audience viewer: stored preference, else single browser-matched language. */
export function resolveViewerLanguagePair(
	slug: string,
	audienceLanguages: string[],
): LanguagePair {
	return (
		storedPairForAudience(slug, audienceLanguages) ??
		defaultAudienceLanguage(audienceLanguages)
	);
}

/** Broadcast / operator: stored preference, else primary + second language. */
export function resolveLanguagePair(
	slug: string,
	audienceLanguages: string[],
): LanguagePair {
	return (
		storedPairForAudience(slug, audienceLanguages) ??
		defaultLanguagePair(audienceLanguages)
	);
}

export function getStoredTextSize(): number {
	if (typeof window === "undefined") return 1;
	const stored = localStorage.getItem(TEXT_SIZE_KEY);

	if (stored === null) return 1;

	const decoded = Option.getOrUndefined(
		Schema.decodeUnknownOption(textSizeSchema)(stored),
	);

	if (decoded !== undefined) return decoded;
	localStorage.removeItem(TEXT_SIZE_KEY);

	return 1;
}

export function setStoredTextSize(size: number) {
	localStorage.setItem(TEXT_SIZE_KEY, String(size));
}
