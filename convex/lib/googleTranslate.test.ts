// @vitest-environment edge-runtime

import { ConfigProvider, Effect, Exit, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import * as jose from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	decodeTranslationDocument,
	encodeTranslationDocument,
	GoogleAuthenticationError,
	GoogleConfigError,
	GoogleResponseError,
	GoogleTransientError,
	GoogleTranslate,
} from "./googleTranslate";
import {
	MappingIntegrityError,
	translationDocuments,
} from "./translationMappings";

const emptyConfig = ConfigProvider.layer(ConfigProvider.fromUnknown({}));

let privateKey = "";

beforeAll(async () => {
	const pair = await jose.generateKeyPair("RS256", { extractable: true });
	privateKey = await jose.exportPKCS8(pair.privateKey);
});

const configLayer = () =>
	ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			GOOGLE_CLOUD_PROJECT_ID: "test-project",
			GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
				client_email: "translator@example.com",
				private_key: privateKey,
			}),
		}),
	);

const plainDocuments = (text: string, targetLanguages: string[]) =>
	translationDocuments(text, [], targetLanguages);

function translateToLanguages<E>(
	google: {
		translateOne: (
			document: ReturnType<typeof plainDocuments>[number],
			sourceLanguage?: string,
		) => Effect.Effect<string, E>;
	},
	documents: ReturnType<typeof plainDocuments>,
	sourceLanguage?: string,
) {
	return Effect.all(
		documents.map((document) =>
			google
				.translateOne(document, sourceLanguage)
				.pipe(
					Effect.map(
						(translation) => [document.targetLanguage, translation] as const,
					),
				),
		),
	).pipe(
		Effect.map((entries) => ({ translations: Object.fromEntries(entries) })),
	);
}

describe("GoogleTranslate", () => {
	it("captures invalid provider configuration when its layer is acquired", async () => {
		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* Effect.flip(
				translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
			);
		}).pipe(Effect.provide(GoogleTranslate.layer), Effect.provide(emptyConfig));

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(GoogleConfigError);
	});

	it("parses the signing key when its layer is acquired", async () => {
		const invalidKeyConfig = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GOOGLE_CLOUD_PROJECT_ID: "test-project",
				GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
					client_email: "translator@example.com",
					private_key: "not-a-private-key",
				}),
			}),
		);

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* Effect.flip(
				translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
			);
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(invalidKeyConfig),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(GoogleConfigError);
	});

	it("rejects a blank service-account identity at layer acquisition", async () => {
		const blankIdentityConfig = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GOOGLE_CLOUD_PROJECT_ID: "test-project",
				GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
					client_email: "  ",
					private_key: privateKey,
				}),
			}),
		);

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* Effect.flip(
				translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
			);
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(blankIdentityConfig),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(GoogleConfigError);
	});

	it("models credential signing rejection as a typed configuration error", async () => {
		const signing = vi
			.spyOn(jose.SignJWT.prototype, "sign")
			.mockRejectedValueOnce(new Error("WebCrypto signing failed"));

		const fetch = vi.fn<typeof globalThis.fetch>();

		try {
			const program = Effect.gen(function* () {
				const google = yield* GoogleTranslate;

				return yield* Effect.flip(
					translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
				);
			}).pipe(
				Effect.provide(GoogleTranslate.layer),
				Effect.provide(configLayer()),
				Effect.provideService(FetchHttpClient.Fetch, fetch),
			);

			const error = await Effect.runPromise(program);
			expect(error).toBeInstanceOf(GoogleConfigError);
			expect(error).toMatchObject({
				operation: "Google.authenticate",
				message: "Google credential signing failed",
			});
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			signing.mockRestore();
		}
	});

	it("does not retain a failed access-token lookup", async () => {
		let tokenRequests = 0;

		const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
			const url = String(input);

			if (url === "https://oauth2.googleapis.com/token") {
				tokenRequests += 1;

				if (tokenRequests <= 3) {
					return new Response(null, { status: 503 });
				}

				return Response.json({ access_token: "token", expires_in: 3600 });
			}

			return Response.json({
				translations: [{ translatedText: "こんにちは" }],
			});
		});

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			const first = yield* Effect.exit(
				translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
			);

			const second = yield* translateToLanguages(
				google,
				plainDocuments("Hello", ["ja"]),
				"en",
			);

			return { first, second };
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(configLayer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const result = await Effect.runPromise(program);
		expect(Exit.isFailure(result.first)).toBe(true);
		expect(result.second.translations).toEqual({ ja: "こんにちは" });
		expect(tokenRequests).toBe(4);
	});

	it("shares one successful token until the provider expiry window", async () => {
		let tokenRequests = 0;

		const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
			const url = String(input);

			if (url === "https://oauth2.googleapis.com/token") {
				tokenRequests += 1;

				return Response.json({ access_token: "token", expires_in: 120 });
			}

			return Response.json({
				translations: [{ translatedText: "こんにちは" }],
			});
		});

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;
			yield* translateToLanguages(
				google,
				plainDocuments("First", ["ja"]),
				"en",
			);
			yield* translateToLanguages(
				google,
				plainDocuments("Second", ["ja"]),
				"en",
			);
			const beforeExpiry = tokenRequests;
			yield* TestClock.adjust("61 seconds");
			yield* translateToLanguages(
				google,
				plainDocuments("Third", ["ja"]),
				"en",
			);

			return beforeExpiry;
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(configLayer()),
			Effect.provide(TestClock.layer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const beforeExpiry = await Effect.runPromise(program);
		expect(beforeExpiry).toBe(1);
		expect(tokenRequests).toBe(2);
	});

	it("keeps authentication rejection distinct from transient failure", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(
			async () => new Response(null, { status: 401 }),
		);

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* Effect.flip(
				translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
			);
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(configLayer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(GoogleAuthenticationError);
	});

	it("reports malformed successful responses without retrying", async () => {
		let translationRequests = 0;

		const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
			const url = String(input);

			if (url === "https://oauth2.googleapis.com/token") {
				return Response.json({ access_token: "token", expires_in: 3600 });
			}

			translationRequests += 1;

			return Response.json({ translations: [] });
		});

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* Effect.flip(
				translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
			);
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(configLayer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(GoogleResponseError);
		expect(translationRequests).toBe(1);
	});

	it("bounds the complete target operation to twenty seconds", async () => {
		let translationRequests = 0;
		let signalRequest: (() => void) | undefined;

		const requestStarted = new Promise<void>((resolve) => {
			signalRequest = resolve;
		});

		const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
			const url = String(input);

			if (url === "https://oauth2.googleapis.com/token") {
				return Response.json({ access_token: "token", expires_in: 3600 });
			}

			translationRequests += 1;
			signalRequest?.();

			return await new Promise<Response>(() => undefined);
		});

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;
			yield* translateToLanguages(
				google,
				plainDocuments("Hello", ["en"]),
				"en",
			);

			const fiber = yield* Effect.forkChild(
				Effect.flip(
					translateToLanguages(google, plainDocuments("Hello", ["ja"]), "en"),
				),
			);

			yield* Effect.promise(() => requestStarted);
			yield* TestClock.adjust("20 seconds");

			return yield* Fiber.join(fiber);
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(configLayer()),
			Effect.provide(TestClock.layer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const error = await Effect.runPromise(program);
		expect(error).toBeInstanceOf(GoogleTransientError);
		expect(translationRequests).toBe(1);
	});

	it("encodes fixed spans safely and decodes reordered provider spans", () => {
		const [document] = translationDocuments(
			"Echo <Live> &",
			[
				{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
				{ term: "Live", targetLanguage: "ja", translation: "ライブ" },
			],
			["ja"],
		);

		if (!document) throw new Error("Expected translation document");

		const encoded = encodeTranslationDocument(document);
		expect(encoded.mimeType).toBe("text/html");
		expect(encoded.contents).toContain("&lt;");
		expect(encoded.contents).toContain("&gt;");
		expect(encoded.contents).toContain("&amp;");
		const [echo, live] = document.fixedSpans;

		if (!echo || !live) throw new Error("Expected fixed spans");

		const reordered = [
			`<span data-echo-occurrence="${live.id}" translate="no">${live.sourceText}</span>`,
			" translated ",
			`<span translate="no" data-echo-occurrence="${echo.id}">${echo.sourceText}</span>`,
		].join("");

		expect(decodeTranslationDocument(document, reordered)).toBe(
			"ライブ translated エコー",
		);
	});

	it("rejects missing, duplicated, and malformed fixed spans", () => {
		const [document] = translationDocuments(
			"Echo",
			[{ term: "Echo", targetLanguage: "ja", translation: "エコー" }],
			["ja"],
		);

		if (!document) throw new Error("Expected translation document");
		const span = document.fixedSpans[0];

		if (!span) throw new Error("Expected fixed span");

		expect(() =>
			decodeTranslationDocument(
				document,
				`<span translate="no" data-echo-occurrence="${span.id}">${span.sourceText}</span><span translate="no" data-echo-occurrence="${span.id}">${span.sourceText}</span>`,
			),
		).toThrow(MappingIntegrityError);
		expect(() =>
			decodeTranslationDocument(
				document,
				'<span translate="no" data-echo-occurrence="missing">Echo</span>',
			),
		).toThrow(MappingIntegrityError);
		expect(() =>
			decodeTranslationDocument(
				document,
				`<span translate="no" data-echo-occurrence="${span.id}"><b>${span.sourceText}</b></span>`,
			),
		).toThrow(MappingIntegrityError);
	});

	it("sends HTML only to matching targets and plain text to no-match targets", async () => {
		const documents = translationDocuments(
			"Echo",
			[{ term: "Echo", targetLanguage: "ja", translation: "エコー" }],
			["ja", "de"],
		);

		const translationRequest = Schema.Struct({
			contents: Schema.Array(Schema.String),
			sourceLanguageCode: Schema.optionalKey(Schema.String),
			targetLanguageCode: Schema.String,
			mimeType: Schema.String,
			model: Schema.String,
		});

		const translationBodies: Array<typeof translationRequest.Type> = [];

		const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
			const url = String(input);

			if (url === "https://oauth2.googleapis.com/token") {
				return Response.json({ access_token: "token", expires_in: 3600 });
			}

			const body = await new Request(input, init).text();

			const parsed = Schema.decodeUnknownSync(translationRequest)(
				JSON.parse(body),
			);

			translationBodies.push(parsed);
			const contents = parsed.contents[0] ?? "";

			return Response.json({
				translations: [
					{
						translatedText: contents.includes("data-echo-occurrence")
							? contents
							: "Echo translated",
					},
				],
			});
		});

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* translateToLanguages(google, documents, "en");
		}).pipe(
			Effect.provide(GoogleTranslate.layer),
			Effect.provide(configLayer()),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		);

		const result = await Effect.runPromise(program);
		expect(result.translations).toEqual({
			ja: "エコー",
			de: "Echo translated",
		});
		expect(translationBodies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ mimeType: "text/html" }),
				expect.objectContaining({ mimeType: "text/plain", contents: ["Echo"] }),
			]),
		);
	});
});
