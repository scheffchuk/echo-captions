// @vitest-environment edge-runtime

import { Config, ConfigProvider, Effect, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { convexConfigLayer } from "./config";

describe("Convex config provider", () => {
	it("can be acquired without Effect evaluating import.meta", async () => {
		const provider = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ConfigProvider.ConfigProvider;
			}).pipe(Effect.provide(convexConfigLayer)),
		);

		expect(provider).toBeDefined();
	});

	it("reads environment values when the lazy layer is built", async () => {
		const previous = process.env.ELEVENLABS_API_KEY;
		process.env.ELEVENLABS_API_KEY = "test-key";

		try {
			const apiKey = await Effect.runPromise(
				Config.redacted("ELEVENLABS_API_KEY").pipe(
					Effect.provide(convexConfigLayer),
				),
			);

			expect(Redacted.value(apiKey)).toBe("test-key");
		} finally {
			if (previous === undefined) {
				delete process.env.ELEVENLABS_API_KEY;
			} else {
				process.env.ELEVENLABS_API_KEY = previous;
			}
		}
	});
});
