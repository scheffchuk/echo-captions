import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { segmentsToFeedItems } from "@/lib/caption-feed-items";

export function useSessionCaptionFeed(sessionId: Id<"sessions"> | undefined) {
	const { results, status } = usePaginatedQuery(
		api.segments.listBySession,
		sessionId ? { sessionId } : "skip",
		{ initialNumItems: 100 },
	);

	return { feedItems: segmentsToFeedItems(results), status };
}
