import type { CaptionFeedItem } from "@/lib/caption-feed-items";
import type { CaptionSegment } from "@/lib/segment-display";

export type OperatorCommitProjection = {
	commitId: string;
	broadcastSequence: number;
	commitOrdinal: number;
	sourceText: string;
	sourceLanguage: string;
	translations: Record<string, string>;
	status: "pending" | "translated" | "failed";
	segmentStatus?: "translated" | "failed" | null;
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
			status:
				commit.status === "pending" && commit.segmentStatus
					? commit.segmentStatus
					: mapCommitStatus(commit.status),
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

	return merged.sort(
		(left, right) =>
			left.broadcastSequence - right.broadcastSequence ||
			left.commitOrdinal - right.commitOrdinal,
	);
}

function mapCommitStatus(
	status: OperatorCommitProjection["status"],
): CaptionSegment["status"] {
	return status === "pending" ? "translating" : status;
}
