import { v } from "convex/values";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { ActionCtx } from "./_generated/server";
import { action } from "./_generated/server";
import { convexConfigLayer } from "./effect/config";
import { exhaustPublicErrors } from "./effect/convex";
import { authErrorCodes, requireOperatorId } from "./lib/auth";
import { Scribe, scribeErrorCodes } from "./lib/scribeClient";

const runtime = ManagedRuntime.make(
	Scribe.layer.pipe(Layer.provide(convexConfigLayer)),
);
const publicErrorCodes = { ...authErrorCodes, ...scribeErrorCodes };

const issueScribeToken = Effect.fn("Scribe.getToken")(function* (
	ctx: ActionCtx,
) {
	yield* requireOperatorId(ctx);
	const scribe = yield* Scribe;
	return yield* scribe.createToken();
});

export const getScribeToken = action({
	args: {},
	returns: v.object({ token: v.string() }),
	handler: (ctx) =>
		runtime.runPromise(
			issueScribeToken(ctx).pipe(exhaustPublicErrors(publicErrorCodes)),
		),
});
