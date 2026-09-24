import {
	Cache,
	Clock,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Exit,
	Layer,
	Number as Num,
	Option,
	Redacted,
	Schedule,
	Schema,
} from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from "effect/unstable/http";
import * as jose from "jose";
import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";
import { toGoogleCode } from "../../shared/languages";
import {
	MappingIntegrityError,
	type TranslationDocument,
} from "./translationMappings";

const TRANSLATION_SCOPE = "https://www.googleapis.com/auth/cloud-translation";

const ACCESS_TOKEN_CACHE_KEY = "access-token";

export class GoogleConfigError extends Schema.TaggedError<GoogleConfigError>()(
	"GoogleConfigError",
	{
		operation: Schema.String,
		message: Schema.String,
	},
) {}

export class GoogleAuthenticationError extends Schema.TaggedError<GoogleAuthenticationError>()(
	"GoogleAuthenticationError",
	{
		operation: Schema.String,
		message: Schema.String,
		status: Schema.Int,
	},
) {}

export class GoogleRejectedError extends Schema.TaggedError<GoogleRejectedError>()(
	"GoogleRejectedError",
	{
		operation: Schema.String,
		message: Schema.String,
		status: Schema.Int,
	},
) {}

export class GoogleTransientError extends Schema.TaggedError<GoogleTransientError>()(
	"GoogleTransientError",
	{
		operation: Schema.String,
		message: Schema.String,
		retryAfterMillis: Schema.optionalKey(Schema.Number),
	},
) {}

export class GoogleResponseError extends Schema.TaggedError<GoogleResponseError>()(
	"GoogleResponseError",
	{
		operation: Schema.String,
		message: Schema.String,
	},
) {}

const GoogleServiceAccount = Schema.Struct({
	client_email: Schema.String,
	private_key: Schema.String,
});

const GoogleTokenResponse = Schema.Struct({
	access_token: Schema.String,
	expires_in: Schema.Number,
});

const GoogleTranslateResponse = Schema.Struct({
	translations: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				translatedText: Schema.optionalKey(Schema.String),
			}),
		),
	),
});

const GoogleTranslateRequest = Schema.Struct({
	contents: Schema.Array(Schema.String),
	sourceLanguageCode: Schema.optionalKey(Schema.String),
	targetLanguageCode: Schema.String,
	mimeType: Schema.String,
	model: Schema.String,
});

export type EncodedTranslationDocument = {
	mimeType: "text/plain" | "text/html";
	contents: string;
};

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			(
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&#39;",
				}) satisfies Record<string, string>
			)[character] ?? character,
	);
}

export function encodeTranslationDocument(
	document: TranslationDocument,
): EncodedTranslationDocument {
	if (document.fixedSpans.length === 0) {
		return {
			mimeType: "text/plain",
			contents: document.spans
				.map((span) => (span.kind === "text" ? span.text : span.sourceText))
				.join(""),
		};
	}

	return {
		mimeType: "text/html",
		contents: document.spans
			.map((span) =>
				span.kind === "text"
					? escapeHtml(span.text)
					: `<span translate="no" data-echo-occurrence="${span.id}">${escapeHtml(span.sourceText)}</span>`,
			)
			.join(""),
	};
}

function attributeValue(
	element: DefaultTreeAdapterTypes.Element,
	name: string,
): string | undefined {
	return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function decodeFixedDocument(
	document: TranslationDocument,
	translatedHtml: string,
): string {
	const expected = new Map(
		document.fixedSpans.map((span) => [span.id, span] as const),
	);

	if (expected.size !== document.fixedSpans.length) {
		throw new MappingIntegrityError({
			message: "Google returned duplicated mapping identities",
		});
	}

	const seen = new Set<string>();
	const fragment = parseFragment(translatedHtml);

	const textValue = (node: DefaultTreeAdapterTypes.Node): string => {
		if (node.nodeName !== "#text") return "";

		// SAFETY: parse5 names text nodes "#text", and only those nodes carry value.
		return (node as DefaultTreeAdapterTypes.TextNode).value;
	};

	const render = (node: DefaultTreeAdapterTypes.Node): string => {
		if (node.nodeName === "#text") {
			return textValue(node);
		}

		if (node.nodeName === "#comment" || node.nodeName === "#documentType") {
			return "";
		}

		if (!("childNodes" in node)) {
			throw new MappingIntegrityError({
				message: "Google returned malformed mapping markup",
			});
		}

		if (!("attrs" in node)) return node.childNodes.map(render).join("");

		const occurrenceId = attributeValue(node, "data-echo-occurrence");
		const translate = attributeValue(node, "translate");

		if (occurrenceId !== undefined || translate !== undefined) {
			if (translate !== "no" || occurrenceId === undefined) {
				throw new MappingIntegrityError({
					message: "Google returned malformed mapping markup",
				});
			}

			const span = expected.get(occurrenceId);

			if (!span || seen.has(occurrenceId)) {
				throw new MappingIntegrityError({
					message:
						"Google returned an unknown or duplicated mapping occurrence",
				});
			}

			if (node.childNodes.some((child) => child.nodeName !== "#text")) {
				throw new MappingIntegrityError({
					message: "Google returned malformed mapping markup",
				});
			}

			const sourceText = node.childNodes.map(textValue).join("");

			if (sourceText !== span.sourceText) {
				throw new MappingIntegrityError({
					message: "Google changed a protected mapping occurrence",
				});
			}

			seen.add(occurrenceId);

			return span.replacement;
		}

		return node.childNodes.map(render).join("");
	};

	const result = fragment.childNodes.map(render).join("");

	if (seen.size !== expected.size) {
		throw new MappingIntegrityError({
			message: "Google omitted a protected mapping occurrence",
		});
	}

	return result;
}

export function decodeTranslationDocument(
	document: TranslationDocument,
	translatedText: string,
): string {
	return document.fixedSpans.length === 0
		? translatedText
		: decodeFixedDocument(document, translatedText);
}

type GoogleRequestError =
	| GoogleConfigError
	| GoogleAuthenticationError
	| GoogleRejectedError
	| GoogleResponseError
	| GoogleTransientError
	| MappingIntegrityError;

const isTransientStatus = (status: number) =>
	status === 408 ||
	status === 429 ||
	status === 500 ||
	status === 502 ||
	status === 503 ||
	status === 504;

const parseRetryAfter = Effect.fn("GoogleTranslate.parseRetryAfter")(function* (
	value: string | undefined,
) {
	if (value === undefined) return undefined;

	const seconds = Num.parse(value);

	if (Option.isSome(seconds)) return Math.max(0, seconds.value * 1000);

	const timestamp = DateTime.make(value);

	if (Option.isNone(timestamp)) return undefined;
	const now = yield* Clock.currentTimeMillis;

	return Math.max(0, DateTime.toEpochMillis(timestamp.value) - now);
});

const retrySchedule = Schedule.max([
	Schedule.exponential("250 millis"),
	Schedule.recurs(2),
]).pipe(
	Schedule.jittered,
	Schedule.setInputType<GoogleRequestError>(),
	Schedule.while(({ input }) => input instanceof GoogleTransientError),
	Schedule.modifyDelay(({ duration, input }) =>
		Effect.succeed(
			input instanceof GoogleTransientError &&
				input.retryAfterMillis !== undefined
				? Duration.max(duration, Duration.millis(input.retryAfterMillis))
				: duration,
		),
	),
);

const loadGoogleConfig = Effect.fn("GoogleTranslate.config")(function* () {
	const configuredProjectId = yield* Config.nonEmptyString(
		"GOOGLE_CLOUD_PROJECT_ID",
	).pipe(
		Effect.mapError(
			() =>
				new GoogleConfigError({
					operation: "Google.config",
					message: "GOOGLE_CLOUD_PROJECT_ID is not configured",
				}),
		),
	);

	const projectId = configuredProjectId.trim();

	if (!projectId) {
		return yield* new GoogleConfigError({
			operation: "Google.config",
			message: "GOOGLE_CLOUD_PROJECT_ID is not configured",
		});
	}

	const credentials = yield* Config.redacted(
		"GOOGLE_APPLICATION_CREDENTIALS_JSON",
	).pipe(
		Effect.mapError(
			() =>
				new GoogleConfigError({
					operation: "Google.config",
					message: "GOOGLE_APPLICATION_CREDENTIALS_JSON is not configured",
				}),
		),
	);

	const serviceAccount = yield* Effect.try({
		try: () =>
			Schema.decodeUnknownSync(GoogleServiceAccount)(
				JSON.parse(Redacted.value(credentials)),
			),
		catch: () =>
			new GoogleConfigError({
				operation: "Google.config",
				message: "Invalid Google credentials JSON",
			}),
	});

	const clientEmail = serviceAccount.client_email.trim();

	if (!clientEmail) {
		return yield* new GoogleConfigError({
			operation: "Google.config",
			message: "Invalid Google credentials JSON",
		});
	}

	const signingKey = yield* Effect.tryPromise({
		try: () => jose.importPKCS8(serviceAccount.private_key, "RS256"),
		catch: () =>
			new GoogleConfigError({
				operation: "Google.config",
				message: "Invalid Google private key",
			}),
	});

	return {
		projectId,
		clientEmail,
		signingKey,
	};
});

const signGoogleJwt = Effect.fn("GoogleTranslate.signJwt")(function* (
	config: Effect.Success<ReturnType<typeof loadGoogleConfig>>,
	now: number,
) {
	const issuedAt = Math.floor(now / 1000);

	return yield* Effect.tryPromise({
		try: () =>
			new jose.SignJWT({ scope: TRANSLATION_SCOPE })
				.setProtectedHeader({ alg: "RS256", typ: "JWT" })
				.setIssuer(config.clientEmail)
				.setAudience("https://oauth2.googleapis.com/token")
				.setIssuedAt(issuedAt)
				.setExpirationTime(issuedAt + 3600)
				.sign(config.signingKey),
		catch: () =>
			new GoogleConfigError({
				operation: "Google.authenticate",
				message: "Google credential signing failed",
			}),
	});
});

export class GoogleTranslate extends Context.Service<
	GoogleTranslate,
	{
		readonly translateOne: (
			document: TranslationDocument,
			sourceLanguage?: string,
		) => Effect.Effect<string, GoogleRequestError>;
	}
>()("echo/GoogleTranslate") {
	static readonly layer = Layer.effect(
		GoogleTranslate,
		Effect.gen(function* () {
			const config = yield* loadGoogleConfig();
			const client = yield* HttpClient.HttpClient;

			const transientResponse = Effect.fn("GoogleTranslate.transientResponse")(
				function* (
					operation: string,
					response: HttpClientResponse.HttpClientResponse,
				) {
					const retryAfterMillis = yield* parseRetryAfter(
						response.headers["retry-after"],
					);

					if (retryAfterMillis === undefined) {
						return yield* new GoogleTransientError({
							operation,
							message: "Google provider is temporarily unavailable",
						});
					}

					return yield* new GoogleTransientError({
						operation,
						message: "Google provider is temporarily unavailable",
						retryAfterMillis,
					});
				},
			);

			const execute = Effect.fn("GoogleTranslate.execute")(function* (
				request: HttpClientRequest.HttpClientRequest,
				operation: string,
				kind: "authentication" | "translation",
			) {
				const response = yield* client.execute(request).pipe(
					Effect.catchReason(
						"HttpClientError",
						"TransportError",
						() =>
							new GoogleTransientError({
								operation,
								message: "Google provider is temporarily unavailable",
							}),
						(_reason, error) => Effect.die(error),
					),
				);

				if (isTransientStatus(response.status)) {
					return yield* transientResponse(operation, response);
				}

				if (response.status < 200 || response.status >= 300) {
					return yield* kind === "authentication"
						? new GoogleAuthenticationError({
								operation,
								message: "Google authentication was rejected",
								status: response.status,
							})
						: new GoogleRejectedError({
								operation,
								message: "Google translation was rejected",
								status: response.status,
							});
				}

				return response;
			});

			const loadAccessToken = Effect.fn("GoogleTranslate.loadAccessToken")(
				function* (_key: string) {
					const now = yield* Clock.currentTimeMillis;
					const jwt = yield* signGoogleJwt(config, now);

					const request = HttpClientRequest.post(
						"https://oauth2.googleapis.com/token",
					).pipe(
						HttpClientRequest.bodyUrlParams({
							grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
							assertion: jwt,
						}),
					);

					const response = yield* execute(
						request,
						"Google.authenticate",
						"authentication",
					);

					const malformedToken = new GoogleResponseError({
						operation: "Google.authenticate",
						message: "Google returned a malformed token response",
					});

					const data = yield* HttpClientResponse.schemaBodyJson(
						GoogleTokenResponse,
					)(response).pipe(
						Effect.catchTag("SchemaError", () => malformedToken),
						Effect.catchReasons(
							"HttpClientError",
							{
								DecodeError: () => malformedToken,
								EmptyBodyError: () => malformedToken,
							},
							(_reason, error) => Effect.die(error),
						),
					);

					const token = data.access_token.trim();

					if (!token || data.expires_in <= 0) {
						return yield* new GoogleResponseError({
							operation: "Google.authenticate",
							message: "Google returned a malformed token response",
						});
					}

					return { token, timeToLiveMs: data.expires_in * 1000 };
				},
				Effect.retry(retrySchedule),
				Effect.timeout("20 seconds"),
				Effect.catchTag(
					"TimeoutError",
					() =>
						new GoogleTransientError({
							operation: "Google.authenticate",
							message: "Google authentication timed out",
						}),
				),
			);

			const tokenCache = yield* Cache.makeWith(loadAccessToken, {
				capacity: 1,
				timeToLive: (exit) =>
					Exit.isSuccess(exit)
						? Duration.millis(Math.max(0, exit.value.timeToLiveMs - 60_000))
						: Duration.zero,
			});

			const getAccessToken = Effect.fn("GoogleTranslate.getAccessToken")(
				function* () {
					const cached = yield* Cache.get(tokenCache, ACCESS_TOKEN_CACHE_KEY);

					return cached.token;
				},
			);

			const translateToLanguageOnce = Effect.fn(
				"GoogleTranslate.translateToLanguageOnce",
			)(function* (
				accessToken: string,
				document: TranslationDocument,
				sourceLanguage?: string,
			) {
				const targetLanguage = document.targetLanguage;
				const googleTarget = toGoogleCode(targetLanguage);

				const googleSource = sourceLanguage
					? toGoogleCode(sourceLanguage)
					: undefined;

				if (googleSource && googleSource === googleTarget) {
					return yield* Effect.try({
						try: () =>
							decodeTranslationDocument(
								document,
								encodeTranslationDocument(document).contents,
							),
						catch: (cause) =>
							cause instanceof MappingIntegrityError
								? cause
								: new GoogleResponseError({
										operation: "Google.translate",
										message: "Google returned malformed mapping markup",
									}),
					});
				}

				const encoded = encodeTranslationDocument(document);

				const translationRequest = {
					contents: [encoded.contents],
					targetLanguageCode: googleTarget,
					mimeType: encoded.mimeType,
					model: `projects/${config.projectId}/locations/global/models/general/nmt`,
				};

				const request = yield* HttpClientRequest.post(
					`https://translation.googleapis.com/v3/projects/${config.projectId}/locations/global:translateText`,
				).pipe(
					HttpClientRequest.bearerToken(accessToken),
					HttpClientRequest.acceptJson,
					HttpClientRequest.schemaBodyJson(GoogleTranslateRequest)(
						googleSource
							? { ...translationRequest, sourceLanguageCode: googleSource }
							: translationRequest,
					),
					Effect.orDie,
				);

				const response = yield* execute(
					request,
					"Google.translate",
					"translation",
				);

				const malformedTranslation = new GoogleResponseError({
					operation: "Google.translate",
					message: "Google returned a malformed translation response",
				});

				const data = yield* HttpClientResponse.schemaBodyJson(
					GoogleTranslateResponse,
				)(response).pipe(
					Effect.catchTag("SchemaError", () => malformedTranslation),
					Effect.catchReasons(
						"HttpClientError",
						{
							DecodeError: () => malformedTranslation,
							EmptyBodyError: () => malformedTranslation,
						},
						(_reason, error) => Effect.die(error),
					),
				);

				const translated = data.translations?.[0]?.translatedText?.trim();

				if (!translated) {
					return yield* new GoogleResponseError({
						operation: "Google.translate",
						message: "Google returned a malformed translation response",
					});
				}

				return yield* Effect.try({
					try: () => decodeTranslationDocument(document, translated),
					catch: (cause) =>
						cause instanceof MappingIntegrityError
							? cause
							: new GoogleResponseError({
									operation: "Google.translate",
									message: "Google returned malformed mapping markup",
								}),
				});
			});

			const translateOne = Effect.fn("GoogleTranslate.translateOne")(
				function* (document: TranslationDocument, sourceLanguage?: string) {
					const accessToken = yield* getAccessToken();

					return yield* translateToLanguageOnce(
						accessToken,
						document,
						sourceLanguage?.trim() || undefined,
					).pipe(Effect.retry(retrySchedule));
				},
				Effect.timeout("20 seconds"),
				Effect.catchTag(
					"TimeoutError",
					() =>
						new GoogleTransientError({
							operation: "Google.translate",
							message: "Google translation timed out",
						}),
				),
			);

			return GoogleTranslate.of({ translateOne });
		}),
	).pipe(
		Layer.catchTag("GoogleConfigError", (error) =>
			Layer.succeed(
				GoogleTranslate,
				GoogleTranslate.of({
					translateOne: () => Effect.fail(error),
				}),
			),
		),
		Layer.provide(FetchHttpClient.layer),
	);
}
