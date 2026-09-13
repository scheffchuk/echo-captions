// @vitest-environment edge-runtime

import { ConfigProvider, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import {
	Scribe,
	ScribeConfigError,
	ScribeRejectedError,
	ScribeResponseError,
	ScribeTransientError,
} from "./scribeClient";

const emptyConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({}));
const configLayer = ConfigProvider.layer(
	ConfigProvider.fromUnknown({ ELEVENLABS_API_KEY: "test-key" }),
);

describe("Scribe", () => {
	it("captures invalid provider configuration when its layer is acquired", async () => {
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			return yield* Effect.flip(scribe.createToken());
		}).pipe(Effect.provide(Scribe.layer), Effect.provide(emptyConfig));

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeConfigError);
	});

	it("rejects a blank API key at layer acquisition", async () => {
		const blankConfig = ConfigProvider.layer(
			ConfigProvider.fromUnknown({ ELEVENLABS_API_KEY: "  " }),
		);
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			return yield* Effect.flip(scribe.createToken());
		}).pipe(Effect.provide(Scribe.layer), Effect.provide(blankConfig));

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeConfigError);
	});

	it("makes no more than three attempts for transient failures", async () => {
		let requests = 0;
		const fetch = vi.fn<typeof globalThis.fetch>(async () => {
			requests += 1;
			return new Response(null, { status: 503 });
		});
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			const fiber = yield* Effect.forkChild(Effect.flip(scribe.createToken()));
			yield* TestClock.adjust("10 seconds");
			return yield* Fiber.join(fiber);
		}).pipe(
			Effect.provide(Scribe.layer),
			Effect.provide(configLayer),
			Effect.provide(TestClock.layer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeTransientError);
		expect(requests).toBe(3);
	});

	it("does not retry a rejected token request", async () => {
		let requests = 0;
		const fetch = vi.fn<typeof globalThis.fetch>(async () => {
			requests += 1;
			return new Response(null, { status: 401 });
		});
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			return yield* Effect.flip(scribe.createToken());
		}).pipe(
			Effect.provide(Scribe.layer),
			Effect.provide(configLayer),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeRejectedError);
		expect(requests).toBe(1);
	});

	it("reports malformed token responses without retrying", async () => {
		let requests = 0;
		const fetch = vi.fn<typeof globalThis.fetch>(async () => {
			requests += 1;
			return Response.json({});
		});
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			return yield* Effect.flip(scribe.createToken());
		}).pipe(
			Effect.provide(Scribe.layer),
			Effect.provide(configLayer),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeResponseError);
		expect(requests).toBe(1);
	});

	it("rejects an empty token as a malformed response", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () =>
			Response.json({ token: "  " }),
		);
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			return yield* Effect.flip(scribe.createToken());
		}).pipe(
			Effect.provide(Scribe.layer),
			Effect.provide(configLayer),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeResponseError);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("bounds all token attempts to ten seconds", async () => {
		let requests = 0;
		let signalRequest: (() => void) | undefined;
		const requestStarted = new Promise<void>((resolve) => {
			signalRequest = resolve;
		});
		const fetch = vi.fn<typeof globalThis.fetch>(async () => {
			requests += 1;
			if (requests === 1) return Response.json({ token: "warm-token" });
			signalRequest?.();
			return await new Promise<Response>(() => undefined);
		});
		const program = Effect.gen(function* () {
			const scribe = yield* Scribe;
			yield* scribe.createToken();
			const fiber = yield* Effect.forkChild(Effect.flip(scribe.createToken()));
			yield* Effect.promise(() => requestStarted);
			yield* TestClock.adjust("10 seconds");
			return yield* Fiber.join(fiber);
		}).pipe(
			Effect.provide(Scribe.layer),
			Effect.provide(configLayer),
			Effect.provide(TestClock.layer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(ScribeTransientError);
		expect(requests).toBe(2);
	});
});
