import {
	optimisticallyUpdateValueInPaginatedQuery,
	type UsePaginatedQueryResult,
	useMutation,
	usePaginatedQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useRef,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type OperatorCommit = FunctionReturnType<
	typeof api.captions.listOperatorCommits
>["page"][number];

export type CaptionRetry = (args: {
	acceptedCommitId: Id<"acceptedCommits">;
}) => Promise<FunctionReturnType<typeof api.captions.retryCommit>>;

function useNativeCommits(sessionId: Id<"sessions"> | undefined) {
	return usePaginatedQuery(
		api.captions.listOperatorCommits,
		sessionId ? { sessionId } : "skip",
		{ initialNumItems: 100 },
	);
}

function useNativeRetry(sessionId: Id<"sessions"> | undefined): CaptionRetry {
	const retry = useMutation(api.captions.retryCommit);

	return useMemo(
		() =>
			retry.withOptimisticUpdate((store, args) => {
				if (!sessionId) return;
				optimisticallyUpdateValueInPaginatedQuery(
					store,
					api.captions.listOperatorCommits,
					{ sessionId },
					(commit): OperatorCommit => {
						if (
							commit.acceptedCommitId !== args.acceptedCommitId ||
							commit.status !== "failed"
						)
							return commit;

						const { error: _error, ...finished } = {
							...commit,
							error: undefined,
						};

						return { ...finished, status: "pending", failedTargetCount: 0 };
					},
				);
			}),
		[retry, sessionId],
	);
}

export type OperatorCaptionAdapters = {
	useCommits: (
		sessionId: Id<"sessions"> | undefined,
	) => UsePaginatedQueryResult<OperatorCommit>;
	useRetry: (sessionId: Id<"sessions"> | undefined) => CaptionRetry;
};

const nativeAdapters: OperatorCaptionAdapters = {
	useCommits: useNativeCommits,
	useRetry: useNativeRetry,
};

const Context = createContext(nativeAdapters);

/** Internal transport seam shared by the production Operator hook and its tests. */
export function OperatorCaptionAdaptersProvider({
	adapters,
	children,
}: {
	adapters: OperatorCaptionAdapters;
	children: ReactNode;
}) {
	const initial = useRef(adapters);

	if (initial.current !== adapters)
		throw new Error(
			"Operator caption adapters cannot change within a mounted tree",
		);

	return <Context.Provider value={adapters}>{children}</Context.Provider>;
}

export function useOperatorCaptionAdapters() {
	return useContext(Context);
}
