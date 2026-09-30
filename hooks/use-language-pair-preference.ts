import { useState } from "react";
import type { LanguagePair } from "@/lib/languages";
import {
	isLanguagePairAvailable,
	resolveLanguagePair,
	resolveViewerLanguagePair,
	setStoredLanguagePair,
} from "@/lib/viewer-preferences";

type Selection = { slug: string; pair: LanguagePair };

export function useLanguagePairPreference(
	slug: string,
	audienceLanguages: string[],
	mode: "operator" | "viewer",
) {
	const [selection, setSelection] = useState<Selection | null>(null);

	const selectedPair =
		selection?.slug === slug &&
		isLanguagePairAvailable(selection.pair, audienceLanguages)
			? selection.pair
			: null;

	const languagePair =
		audienceLanguages.length === 0
			? null
			: (selectedPair ??
				(mode === "viewer"
					? resolveViewerLanguagePair(slug, audienceLanguages)
					: resolveLanguagePair(slug, audienceLanguages)));

	const changeLanguagePair = (next: LanguagePair) => {
		setSelection({ slug, pair: next });
		setStoredLanguagePair(slug, next);
	};

	return { languagePair, changeLanguagePair };
}
