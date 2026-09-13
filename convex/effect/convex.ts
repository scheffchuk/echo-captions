import { ConvexError } from "convex/values";
import { Effect, Schema } from "effect";

export class PersistenceError extends Schema.TaggedError<PersistenceError>()(
	"PersistenceError",
	{
		operation: Schema.String,
		message: Schema.String,
		cause: Schema.Defect(),
	},
) {}

export const fromConvex = <A>(run: () => Promise<A>, operation: string) =>
	Effect.tryPromise({
		try: run,
		catch: (cause) =>
			new PersistenceError({
				operation,
				message: `${operation} failed`,
				cause,
			}),
	});

const isTaggedPublicError = Schema.is(
	Schema.Struct({
		_tag: Schema.String,
		message: Schema.String,
	}),
);

type TaggedPublicError = {
	readonly _tag: string;
	readonly message: string;
};

type MissingPublicErrorCode<E, Codes> = E extends PersistenceError
	? never
	: E extends TaggedPublicError
		? E["_tag"] extends keyof Codes
			? never
			: E["_tag"]
		: "UntaggedError";

declare const missingPublicErrorCodes: unique symbol;

type ExhaustivePublicEffect<A, E, R, Codes> = Effect.Effect<A, E, R> &
	([MissingPublicErrorCode<E, Codes>] extends [never]
		? unknown
		: {
				readonly [missingPublicErrorCodes]: MissingPublicErrorCode<E, Codes>;
			});

export const exhaustPublicErrors =
	<const Codes extends Readonly<Record<string, string>>>(codes: Codes) =>
	<A, E, R>(
		effect: ExhaustivePublicEffect<A, E, R, Codes>,
	): Effect.Effect<A, never, R> =>
		Effect.catch(effect, (error) => {
			if (isTaggedPublicError(error)) {
				const code = codes[error._tag];
				if (code !== undefined) {
					return Effect.die(new ConvexError({ code, message: error.message }));
				}
			}

			return Effect.die(error);
		});
