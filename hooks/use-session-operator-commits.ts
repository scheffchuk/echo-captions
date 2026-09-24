import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function useSessionOperatorCommits(
	sessionId: Id<"sessions"> | undefined,
) {
	const { results } = usePaginatedQuery(
		api.captions.listOperatorCommits,
		sessionId ? { sessionId } : "skip",
		{ initialNumItems: 100 },
	);

	return results.slice().reverse();
}
