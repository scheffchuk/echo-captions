import type { CaptionFeedItem } from "@/lib/caption-feed-items";
import type { CaptionSegment } from "@/lib/segment-display";

export type OperatorCommitProjection = {
	commitId: string;
	broadcastSequence?: number;
	commitOrdinal?: number;
	sourceText: string;
	sourceLanguage: string;
	translations: Record<string, string>;
	status: "pending" | "translated" | "failed";
};

export function operatorCommitsToFeedItems(
	commits: readonly OperatorCommitProjection[] | undefined,
): CaptionFeedItem[] {
	return (commits ?? []).map((commit) => ({
		id: commit.commitId,
		segment: {
			sourceText: commit.sourceText,
			sourceLanguage: commit.sourceLanguage,
			translations: commit.translations,
			status: mapCommitStatus(commit.status),
		},
	}));
}

export function mergeOperatorCommitProjections(
	commits: readonly OperatorCommitProjection[] | undefined,
	optimistic: readonly OperatorCommitProjection[] = [],
): OperatorCommitProjection[] {
	const committedIds = new Set(
		(commits ?? []).map((commit) => commit.commitId),
	);
	const merged = [
		...(commits ?? []),
		...optimistic.filter((commit) => !committedIds.has(commit.commitId)),
	];
	if (
		merged.every(
			(commit) =>
				commit.broadcastSequence !== undefined &&
				commit.commitOrdinal !== undefined,
		)
	) {
		return merged
			.slice()
			.sort(
				(left, right) =>
					(left.broadcastSequence ?? Number.MAX_SAFE_INTEGER) -
						(right.broadcastSequence ?? Number.MAX_SAFE_INTEGER) ||
					(left.commitOrdinal ?? Number.MAX_SAFE_INTEGER) -
						(right.commitOrdinal ?? Number.MAX_SAFE_INTEGER),
			);
	}
	return merged;
}

function mapCommitStatus(
	status: OperatorCommitProjection["status"],
): CaptionSegment["status"] {
	return status === "pending" ? "translating" : status;
}
