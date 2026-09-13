"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { segmentsToFeedItems } from "@/lib/caption-feed-items";

export function useSessionCaptionFeed(
	sessionId: Id<"sessions"> | undefined,
	initialNumItems = 100,
) {
	const { results, status, loadMore } = usePaginatedQuery(
		api.segments.listBySession,
		sessionId ? { sessionId } : "skip",
		{ initialNumItems },
	);

	return {
		feedItems: segmentsToFeedItems(results),
		status,
		loadMore,
	};
}
