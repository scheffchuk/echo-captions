import {
	Config,
	Context,
	Effect,
	Layer,
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

export class ScribeConfigError extends Schema.TaggedError<ScribeConfigError>()(
	"ScribeConfigError",
	{
		operation: Schema.String,
		message: Schema.String,
	},
) {}

export class ScribeRejectedError extends Schema.TaggedError<ScribeRejectedError>()(
	"ScribeRejectedError",
	{
		operation: Schema.String,
		message: Schema.String,
		status: Schema.Int,
	},
) {}

export class ScribeTransientError extends Schema.TaggedError<ScribeTransientError>()(
	"ScribeTransientError",
	{
		operation: Schema.String,
		message: Schema.String,
	},
) {}

export class ScribeResponseError extends Schema.TaggedError<ScribeResponseError>()(
	"ScribeResponseError",
	{
		operation: Schema.String,
		message: Schema.String,
	},
) {}

export const scribeErrorCodes = {
	ScribeConfigError: "scribe_configuration_error",
	ScribeRejectedError: "scribe_rejected",
	ScribeResponseError: "scribe_malformed_response",
	ScribeTransientError: "scribe_unavailable",
} as const;

const ScribeTokenResponse = Schema.Struct({
	token: Schema.String,
});

const isTransientStatus = (status: number) =>
	status === 408 ||
	status === 429 ||
	status === 500 ||
	status === 502 ||
	status === 503 ||
	status === 504;

type ScribeRequestError =
	| ScribeConfigError
	| ScribeRejectedError
	| ScribeResponseError
	| ScribeTransientError;

const retrySchedule = Schedule.max([
	Schedule.exponential("200 millis"),
	Schedule.recurs(2),
]).pipe(
	Schedule.jittered,
	Schedule.setInputType<ScribeRequestError>(),
	Schedule.while(({ input }) => input instanceof ScribeTransientError),
);

export class Scribe extends Context.Service<
	Scribe,
	{
		readonly createToken: () => Effect.Effect<
			{ token: string },
			ScribeRequestError
		>;
	}
>()("echo/Scribe") {
	static readonly layer = Layer.effect(
		Scribe,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;

			const apiKey = yield* Config.redacted("ELEVENLABS_API_KEY").pipe(
				Effect.mapError(
					() =>
						new ScribeConfigError({
							operation: "Scribe.config",
							message: "ELEVENLABS_API_KEY is not configured",
						}),
				),
			);

			if (!Redacted.value(apiKey).trim()) {
				return yield* new ScribeConfigError({
					operation: "Scribe.config",
					message: "ELEVENLABS_API_KEY is not configured",
				});
			}

			const requestToken = Effect.fn("Scribe.requestToken")(function* () {
				const response = yield* HttpClientRequest.post(
					"https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
				).pipe(
					HttpClientRequest.setHeader("xi-api-key", Redacted.value(apiKey)),
					client.execute,
					Effect.catchReason(
						"HttpClientError",
						"TransportError",
						() =>
							new ScribeTransientError({
								operation: "Scribe.createToken",
								message: "Scribe token service is unavailable",
							}),
						(_reason, error) => Effect.die(error),
					),
				);

				if (isTransientStatus(response.status)) {
					return yield* new ScribeTransientError({
						operation: "Scribe.createToken",
						message: "Scribe token service is unavailable",
					});
				}

				if (response.status < 200 || response.status >= 300) {
					return yield* new ScribeRejectedError({
						operation: "Scribe.createToken",
						message: "Scribe token request was rejected",
						status: response.status,
					});
				}

				const malformedToken = new ScribeResponseError({
					operation: "Scribe.createToken",
					message: "Scribe returned a malformed token response",
				});

				const data = yield* HttpClientResponse.schemaBodyJson(
					ScribeTokenResponse,
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

				const token = data.token.trim();

				if (!token) {
					return yield* new ScribeResponseError({
						operation: "Scribe.createToken",
						message: "Scribe returned a malformed token response",
					});
				}

				return { token };
			});

			const createToken = Effect.fn("Scribe.createToken")(
				function* () {
					return yield* requestToken();
				},
				Effect.retry(retrySchedule),
				Effect.timeout("10 seconds"),
				Effect.catchTag(
					"TimeoutError",
					() =>
						new ScribeTransientError({
							operation: "Scribe.createToken",
							message: "Scribe token request timed out",
						}),
				),
			);

			return Scribe.of({ createToken });
		}),
	).pipe(
		Layer.catchTag("ScribeConfigError", (error) =>
			Layer.succeed(
				Scribe,
				Scribe.of({ createToken: () => Effect.fail(error) }),
			),
		),
		Layer.provide(FetchHttpClient.layer),
	);
}
