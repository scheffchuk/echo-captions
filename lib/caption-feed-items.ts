import type { CaptionSegment } from "@/lib/segment-display";

/** Convex `listBySession` returns newest-first; feed UI wants oldest→newest. */
export function segmentsToFeedItems(
	newestFirst: readonly (CaptionSegment & { _id: string })[] | undefined,
) {
	return (newestFirst ?? [])
		.slice()
		.reverse()
		.map(({ _id, ...segment }) => ({
			id: _id,
			segment,
		}));
}

export type CaptionFeedItem = ReturnType<typeof segmentsToFeedItems>[number];
