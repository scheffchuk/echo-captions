import { describe, expect, it } from "vitest";
import {
	mergeOperatorCommitProjections,
	type OperatorCommitProjection,
	operatorCommitsToFeedItems,
} from "@/lib/operator-commit-feed";

function commit(
	commitId: string,
	sourceText: string,
	status: OperatorCommitProjection["status"] = "translated",
): OperatorCommitProjection {
	return {
		commitId,
		sourceText,
		sourceLanguage: "en",
		translations: {},
		status,
	};
}

describe("operator commit feed", () => {
	it("uses Commit ID as the feed identity, including for repeated captions", () => {
		const items = operatorCommitsToFeedItems([
			commit("commit-1", "hello"),
			commit("commit-2", "hello"),
		]);

		expect(items.map((item) => item.id)).toEqual(["commit-1", "commit-2"]);
		expect(items.map((item) => item.segment.sourceText)).toEqual([
			"hello",
			"hello",
		]);
	});

	it("projects an accepted pending commit without matching by source text", () => {
		const [item] = operatorCommitsToFeedItems([
			commit("pending-1", "hello", "pending"),
		]);

		expect(item).toEqual({
			id: "pending-1",
			segment: {
				sourceText: "hello",
				sourceLanguage: "en",
				translations: {},
				status: "translating",
			},
		});
	});

	it("orders optimistic commits by broadcast sequence before commit ordinal", () => {
		const merged = mergeOperatorCommitProjections(
			[
				{
					...commit("old-broadcast", "old"),
					broadcastSequence: 1,
					commitOrdinal: 4,
				},
			],
			[
				{
					...commit("new-broadcast", "new", "pending"),
					broadcastSequence: 2,
					commitOrdinal: 1,
				},
			],
		);

		expect(merged.map((item) => item.commitId)).toEqual([
			"old-broadcast",
			"new-broadcast",
		]);
	});
});
