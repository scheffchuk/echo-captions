import { v } from "convex/values";
import { Effect } from "effect";
import { internalMutation, mutation } from "./_generated/server";
import { exhaustPublicErrors } from "./effect/convex";
import { runConvex } from "./effect/run";
import { authErrorCodes } from "./lib/auth";
import type { HeartbeatExpiryArgs } from "./lib/broadcasts";
import {
	abandonBroadcast,
	broadcastErrorCodes,
	markBroadcastLost,
	resumeBroadcast,
	sendHeartbeat,
	startBroadcast,
	stopBroadcast,
} from "./lib/broadcasts";
import { sessionErrorCodes } from "./lib/sessions";
import { broadcastStatusValidator } from "./schema";

const publicErrorCodes = {
	...authErrorCodes,
	...broadcastErrorCodes,
	...sessionErrorCodes,
};

const broadcastResultValidator = v.object({
	broadcastId: v.id("broadcasts"),
	sequence: v.number(),
	status: broadcastStatusValidator,
	lastCommitOrdinal: v.number(),
	finalCommitOrdinal: v.optional(v.number()),
});

export const start = mutation({
	args: { sessionId: v.id("sessions") },
	returns: broadcastResultValidator,
	handler: (ctx, args) =>
		runConvex(
			startBroadcast(ctx, args.sessionId).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const heartbeat = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: v.null(),
	handler: (ctx, args) =>
		runConvex(
			sendHeartbeat(ctx, args.broadcastId).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const stop = mutation({
	args: {
		broadcastId: v.id("broadcasts"),
		finalCommitOrdinal: v.optional(v.number()),
	},
	returns: broadcastResultValidator,
	handler: (ctx, args) =>
		runConvex(
			stopBroadcast(ctx, args).pipe(exhaustPublicErrors(publicErrorCodes)),
		),
});

export const resume = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: broadcastResultValidator,
	handler: (ctx, args) =>
		runConvex(
			resumeBroadcast(ctx, args.broadcastId).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const abandon = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: broadcastResultValidator,
	handler: (ctx, args) =>
		runConvex(
			abandonBroadcast(ctx, args.broadcastId).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const markLost = internalMutation({
	args: {
		broadcastId: v.id("broadcasts"),
	},
	returns: v.null(),
	handler: (ctx, args: HeartbeatExpiryArgs) =>
		runConvex(markBroadcastLost(ctx, args).pipe(Effect.orDie)),
});
