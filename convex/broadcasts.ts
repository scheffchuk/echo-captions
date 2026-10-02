import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { HeartbeatExpiryArgs } from "./lib/broadcasts";
import {
	abandonBroadcast,
	markBroadcastLost,
	resumeBroadcast,
	sendHeartbeat,
	startBroadcast,
	stopBroadcast,
} from "./lib/broadcasts";
import { broadcastStatusValidator } from "./schema";

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
	handler: (ctx, args) => startBroadcast(ctx, args.sessionId),
});

export const heartbeat = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: v.null(),
	handler: (ctx, args) => sendHeartbeat(ctx, args.broadcastId),
});

export const stop = mutation({
	args: {
		broadcastId: v.id("broadcasts"),
		finalCommitOrdinal: v.optional(v.number()),
	},
	returns: broadcastResultValidator,
	handler: (ctx, args) => stopBroadcast(ctx, args),
});

export const resume = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: broadcastResultValidator,
	handler: (ctx, args) => resumeBroadcast(ctx, args.broadcastId),
});

export const abandon = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: broadcastResultValidator,
	handler: (ctx, args) => abandonBroadcast(ctx, args.broadcastId),
});

export const markLost = internalMutation({
	args: {
		broadcastId: v.id("broadcasts"),
	},
	returns: v.null(),
	handler: async (ctx, args: HeartbeatExpiryArgs) =>
		await markBroadcastLost(ctx, args),
});
