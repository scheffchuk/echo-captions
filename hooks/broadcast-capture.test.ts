import { describe, expect, it } from "vitest";
import {
	activateCaptureBuffer,
	appendCapture,
	type CaptureEvent,
	createCaptureBuffer,
	formatRejectedCaptures,
	isCurrentCaptureGeneration,
	removeCapture,
	toRejectedCapture,
} from "@/hooks/broadcast-capture";

function event(
	text: string,
	generation = 0,
	commitId = `commit-${text}`,
): CaptureEvent {
	return {
		generation,
		commitId,
		sourceText: text,
		sourceLanguage: "en",
		capturedAt: 100,
	};
}

describe("broadcast capture buffer", () => {
	it("assigns stable IDs and preserves callback order while activation is pending", () => {
		let buffer = createCaptureBuffer({ generation: 3 });
		const first = appendCapture(buffer, event("same", 3));
		buffer = first.buffer;
		const second = appendCapture(buffer, event("same", 3, "commit-2"));
		buffer = second.buffer;

		expect(buffer.pending).toEqual([
			expect.objectContaining({
				commitId: "commit-same",
				commitOrdinal: 1,
				sourceText: "same",
			}),
			expect.objectContaining({
				commitId: "commit-2",
				commitOrdinal: 2,
				sourceText: "same",
			}),
		]);

		const activated = activateCaptureBuffer(buffer, "broadcast-1", 7);
		expect(activated.broadcastId).toBe("broadcast-1");
		expect(activated.pending.map((capture) => capture.commitOrdinal)).toEqual([
			8, 9,
		]);
		expect(activated.nextCommitOrdinal).toBe(10);
	});

	it("rejects stale callback generations before they can enter the buffer", () => {
		const buffer = createCaptureBuffer({ generation: 2 });

		expect(isCurrentCaptureGeneration(event("old", 1), buffer)).toBe(false);
		expect(() => appendCapture(buffer, event("old", 1))).not.toThrow();
		expect(appendCapture(buffer, event("old", 1)).buffer.pending).toEqual([]);
	});

	it("removes only the rejected capture, leaving later captures available", () => {
		let buffer = createCaptureBuffer({ generation: 0 });
		buffer = appendCapture(buffer, event("first")).buffer;
		buffer = appendCapture(buffer, event("second", 0, "commit-second")).buffer;

		const remaining = removeCapture(buffer, "commit-first");
		expect(remaining.pending.map((capture) => capture.commitId)).toEqual([
			"commit-second",
		]);
	});

	it("keeps rejected captures exportable without merging repeated source text", () => {
		const rejected = [
			toRejectedCapture(
				{
					commitId: "commit-1",
					commitOrdinal: 1,
					sourceText: "same",
					sourceLanguage: "en",
					capturedAt: 100,
				},
				"Broadcast is no longer active",
			),
			toRejectedCapture(
				{
					commitId: "commit-2",
					commitOrdinal: 2,
					sourceText: "same",
					sourceLanguage: "en",
					capturedAt: 200,
				},
				"Broadcast is no longer active",
			),
		];

		expect(formatRejectedCaptures(rejected)).toContain("commit-1");
		expect(formatRejectedCaptures(rejected)).toContain("commit-2");
		expect(formatRejectedCaptures(rejected)).toContain("same\n");
	});
});
