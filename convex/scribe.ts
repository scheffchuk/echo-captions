import { ConvexError, v } from "convex/values";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
	isTaggedPublicError,
	publicErrorCode,
} from "../shared/tagged-public-error";
import { action } from "./_generated/server";
import { convexConfigLayer } from "./effect/config";
import { authErrorCodes, requireOperatorId } from "./lib/auth";
import { Scribe, scribeErrorCodes } from "./lib/scribeClient";

const runtime = ManagedRuntime.make(
	Scribe.layer.pipe(Layer.provide(convexConfigLayer)),
);

const publicErrorCodes = { ...authErrorCodes, ...scribeErrorCodes };

async function atPublicEdge<A>(operation: () => Promise<A>): Promise<A> {
	try {
		return await operation();
	} catch (error) {
		if (isTaggedPublicError(error)) {
			const code = publicErrorCode(publicErrorCodes, error._tag);

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
