import { describe, expect, it } from "vitest";
import { segmentsToFeedItems } from "@/lib/caption-feed-items";

describe("segmentsToFeedItems", () => {
	it("returns empty for undefined or empty", () => {
		expect(segmentsToFeedItems(undefined)).toEqual([]);
		expect(segmentsToFeedItems([])).toEqual([]);
	});

	it("reverses newest-first Convex rows to oldest-first feed items", () => {
		const items = segmentsToFeedItems([
			{
				_id: "new",
				sourceText: "second",
				sourceLanguage: "en",
				translations: {},
				status: "translated",
			},
			{
				_id: "old",
				sourceText: "first",
				sourceLanguage: "en",
				translations: {},
				status: "translated",
			},
		]);

		expect(items.map((i) => i.id)).toEqual(["old", "new"]);
		expect(items[0].segment.sourceText).toBe("first");
	});
});
