export type CaptionSegment = {
	sourceText: string;
	sourceLanguage: string;
	translations: Record<string, string>;
	status: "translating" | "translated" | "failed";
};

export type CaptionLine = CaptionSegment & { id: string };

export function getSegmentDisplay(segment: CaptionSegment, code: string) {
	if (code === segment.sourceLanguage) {
		return { text: segment.sourceText, pending: false };
	}

	const translated = segment.translations[code];

	if (translated) {
		return { text: translated, pending: false };
	}

	// Missing target (partial failure) or in-flight/failed — show source as pending.
	return { text: segment.sourceText, pending: true };
}
