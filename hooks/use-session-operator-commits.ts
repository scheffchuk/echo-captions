import { useCallback, useMemo, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useOperatorCaptionAdapters } from "@/hooks/operator-caption-adapters";
import { getPublicConvexError } from "@/lib/expected-errors";

export function useSessionOperatorCommits(
	sessionId: Id<"sessions"> | undefined,
	onError?: (message: string) => void,
) {
	const { useCommits, useRetry } = useOperatorCaptionAdapters();
	const page = useCommits(sessionId);
	const retryMutation = useRetry(sessionId);
	const admissions = useRef(new Set<string>());

	const [pendingAdmissions, setPendingAdmissions] = useState<
		ReadonlySet<string>
	>(new Set());

	const commits = useMemo(() => page.results.slice().reverse(), [page.results]);

	const retry = useCallback(
		async (commitId: string) => {
			const commit = page.results.find((item) => item.commitId === commitId);

			if (
				!sessionId ||
				!commit ||
				commit.status !== "failed" ||
				admissions.current.has(commitId)
			)
				return;
			admissions.current.add(commitId);
			setPendingAdmissions(new Set(admissions.current));

			try {
				await retryMutation({ acceptedCommitId: commit.acceptedCommitId });
			} catch (cause) {
				const failure = getPublicConvexError(
					cause,
					"Could not retry this caption.",
				);

				onError?.(failure.message);
			} finally {
				admissions.current.delete(commitId);
				setPendingAdmissions(new Set(admissions.current));
			}
		},
		[page.results, sessionId, retryMutation, onError],
	);

	const isRetrying = useCallback(
		(commitId: string) =>
			pendingAdmissions.has(commitId) ||
			page.results.some(
				(item) =>
					item.commitId === commitId &&
					item.status === "pending" &&
					item.segmentId !== null,
			),
		[pendingAdmissions, page.results],
	);

	const loadOlder = useCallback(() => {
		if (sessionId && page.status === "CanLoadMore") page.loadMore(100);
	}, [sessionId, page.status, page.loadMore]);

	return {
		commits,
		retry,
		isRetrying,
		loadOlder,
		canLoadOlder: page.status === "CanLoadMore",
		loadingOlder: page.status === "LoadingMore",
	};
}
