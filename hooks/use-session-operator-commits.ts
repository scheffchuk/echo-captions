"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { operatorCommitsToFeedItems } from "@/lib/operator-commit-feed";

export function useSessionOperatorCommits(
	sessionId: Id<"sessions"> | undefined,
	initialNumItems = 100,
) {
	const { results, status, loadMore } = usePaginatedQuery(
		api.captions.listOperatorCommits,
		sessionId ? { sessionId } : "skip",
		{ initialNumItems },
	);

	const commits = results.slice().reverse();
	return {
		commits,
		feedItems: operatorCommitsToFeedItems(commits),
		status,
		loadMore,
	};
}
