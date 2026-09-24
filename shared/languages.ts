export const COMMON_LANGUAGES = [
	{ code: "en", name: "English" },
	{ code: "zh", name: "Chinese" },
	{ code: "ja", name: "Japanese" },
	{ code: "ko", name: "Korean" },
	{ code: "es", name: "Spanish" },
	{ code: "fr", name: "French" },
	{ code: "de", name: "German" },
	{ code: "it", name: "Italian" },
	{ code: "pt", name: "Portuguese" },
	{ code: "ru", name: "Russian" },
	{ code: "ar", name: "Arabic" },
	{ code: "hi", name: "Hindi" },
	{ code: "bn", name: "Bengali" },
	{ code: "pa", name: "Punjabi" },
	{ code: "ur", name: "Urdu" },
	{ code: "id", name: "Indonesian" },
	{ code: "ms", name: "Malay" },
	{ code: "th", name: "Thai" },
	{ code: "vi", name: "Vietnamese" },
	{ code: "tr", name: "Turkish" },
	{ code: "fa", name: "Persian" },
	{ code: "nl", name: "Dutch" },
	{ code: "pl", name: "Polish" },
	{ code: "uk", name: "Ukrainian" },
	{ code: "ro", name: "Romanian" },
	{ code: "el", name: "Greek" },
	{ code: "cs", name: "Czech" },
	{ code: "sv", name: "Swedish" },
	{ code: "da", name: "Danish" },
	{ code: "fi", name: "Finnish" },
	{ code: "no", name: "Norwegian" },
	{ code: "he", name: "Hebrew" },
	{ code: "hu", name: "Hungarian" },
	{ code: "tl", name: "Filipino" },
	{ code: "sw", name: "Swahili" },
	{ code: "ta", name: "Tamil" },
	{ code: "te", name: "Telugu" },
] as const;

type LanguageCode = (typeof COMMON_LANGUAGES)[number]["code"];

export const MAX_SPOKEN_LANGUAGES = 3;

const SUPPORTED_SET = new Set<string>(
	COMMON_LANGUAGES.map((language) => language.code),
);

const SCRIBE_TO_INTERNAL = {
	eng: "en",
	cmn: "zh",
	zho: "zh",
	jpn: "ja",
	kor: "ko",
	spa: "es",
	fra: "fr",
	deu: "de",
	ita: "it",
	por: "pt",
	rus: "ru",
	ara: "ar",
	hin: "hi",
	ben: "bn",
	pan: "pa",
	urd: "ur",
	ind: "id",
	msa: "ms",
	tha: "th",
	vie: "vi",
	tur: "tr",
	fas: "fa",
	nld: "nl",
	pol: "pl",
	ukr: "uk",
	ron: "ro",
	ell: "el",
	ces: "cs",
	swe: "sv",
	dan: "da",
	fin: "fi",
	nor: "no",
	heb: "he",
	hun: "hu",
	tgl: "tl",
	swa: "sw",
	tam: "ta",
	tel: "te",
};

export function normalizeLanguageCode(code: string): string {
	const normalized = code.trim().toLowerCase();

	if (normalized === "zh-cn" || normalized === "zh-tw") return "zh";

	if (normalized === "zh-hans" || normalized === "zh-hant") return "zh";
	const base = normalized.split("-")[0];

	return base === "zh" ? "zh" : base;
}

function isSupportedLanguageCode(code: string): code is LanguageCode {
	return SUPPORTED_SET.has(code);
}

export function isValidLanguageCode(code: string): boolean {
	return isSupportedLanguageCode(normalizeLanguageCode(code));
}

export function fromScribeCode(code: string | undefined): string | undefined {
	if (!code) return undefined;
	const normalized = normalizeLanguageCode(code);

	if (isSupportedLanguageCode(normalized)) return normalized;

	return Object.entries(SCRIBE_TO_INTERNAL).find(
		([scribeCode]) => scribeCode === normalized,
	)?.[1];
}

export function toGoogleCode(code: string): string {
	const normalized = normalizeLanguageCode(code);

	if (normalized === "zh") return "zh-CN";

	return normalized;
}
