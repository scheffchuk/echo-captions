import { ConvexError, v } from "convex/values";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { action } from "./_generated/server";
import { convexConfigLayer } from "./effect/config";
import { authErrorCodes, requireOperatorId } from "./lib/auth";
import { Scribe, scribeErrorCodes } from "./lib/scribeClient";

const runtime = ManagedRuntime.make(
	Scribe.layer.pipe(Layer.provide(convexConfigLayer)),
);
const publicErrorCodes = { ...authErrorCodes, ...scribeErrorCodes };

const isTaggedPublicError = Schema.is(
	Schema.Struct({
		_tag: Schema.String,
		message: Schema.String,
	}),
);

async function atPublicEdge<A>(operation: () => Promise<A>): Promise<A> {
	try {
		return await operation();
	} catch (error) {
		if (isTaggedPublicError(error)) {
			const code =
				publicErrorCodes[error._tag as keyof typeof publicErrorCodes];
			if (code !== undefined) {
				throw new ConvexError({ code, message: error.message });
			}
		}
		throw error;
	}
}

const issueScribeToken = Effect.fn("Scribe.getToken")(function* () {
	const scribe = yield* Scribe;
	return yield* scribe.createToken();
});

export const getScribeToken = action({
	args: {},
	returns: v.object({ token: v.string() }),
	handler: (ctx) =>
		atPublicEdge(async () => {
			await requireOperatorId(ctx);
			return runtime.runPromise(issueScribeToken());
		}),
});
