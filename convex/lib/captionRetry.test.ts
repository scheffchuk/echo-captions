import { describe, expect, it } from "vitest";
import { captionTargetRetryDelay } from "./captionRetry";

describe("caption target retry policy", () => {
	it("uses exponential backoff and positive jitter", () => {
		expect(captionTargetRetryDelay({ previousAttempts: 1, jitter: 0 })).toBe(
			500,
		);
		expect(captionTargetRetryDelay({ previousAttempts: 1, jitter: 1 })).toBe(
			600,
		);
	});

	it("honors provider delays without accepting an unbounded value", () => {
		expect(
			captionTargetRetryDelay({
				retryAfterMillis: 60_000,
				previousAttempts: 0,
				jitter: 0,
			}),
		).toBe(60_000);
		expect(
			captionTargetRetryDelay({
				retryAfterMillis: Number.POSITIVE_INFINITY,
				previousAttempts: 0,
				jitter: 0,
			}),
		).toBe(250);
		expect(
			captionTargetRetryDelay({
				retryAfterMillis: 60 * 60 * 1_000,
				previousAttempts: 0,
				jitter: 1,
			}),
		).toBe(5 * 60 * 1_000);
	});
});
