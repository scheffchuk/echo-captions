import { v } from "convex/values";
import { Effect, Layer, ManagedRuntime } from "effect";
import { action } from "./_generated/server";
import { convexConfigLayer } from "./effect/config";
import { authErrorCodes, requireOperatorId } from "./lib/auth";
import { atPublicEdge } from "./lib/publicEdge";
import { Scribe, scribeErrorCodes } from "./lib/scribeClient";

const runtime = ManagedRuntime.make(
	Scribe.layer.pipe(Layer.provide(convexConfigLayer)),
);

const publicErrorCodes = { ...authErrorCodes, ...scribeErrorCodes };

const issueScribeToken = Effect.fn("Scribe.getToken")(function* () {
	const scribe = yield* Scribe;

	return yield* scribe.createToken();
});

export const getScribeToken = action({
	args: {},
	returns: v.object({ token: v.string() }),
	handler: (ctx) =>
		atPublicEdge(publicErrorCodes, async () => {
			await requireOperatorId(ctx);

			return runtime.runPromise(issueScribeToken());
		}),
});
