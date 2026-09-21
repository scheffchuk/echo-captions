import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
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

type TaggedPublicError = {
	readonly _tag: string;
	readonly message: string;
};

function isTaggedPublicError(error: unknown): error is TaggedPublicError {
	if (typeof error !== "object" || error === null) return false;
	const candidate = error as { _tag?: unknown; message?: unknown };
	return (
		typeof candidate._tag === "string" && typeof candidate.message === "string"
	);
}

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
		atPublicEdge(() => startBroadcast(ctx, args.sessionId)),
});

export const heartbeat = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: v.null(),
	handler: (ctx, args) =>
		atPublicEdge(() => sendHeartbeat(ctx, args.broadcastId)),
});

export const stop = mutation({
	args: {
		broadcastId: v.id("broadcasts"),
		finalCommitOrdinal: v.optional(v.number()),
	},
	returns: broadcastResultValidator,
	handler: (ctx, args) => atPublicEdge(() => stopBroadcast(ctx, args)),
});

export const resume = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: broadcastResultValidator,
	handler: (ctx, args) =>
		atPublicEdge(() => resumeBroadcast(ctx, args.broadcastId)),
});

export const abandon = mutation({
	args: { broadcastId: v.id("broadcasts") },
	returns: broadcastResultValidator,
	handler: (ctx, args) =>
		atPublicEdge(() => abandonBroadcast(ctx, args.broadcastId)),
});

export const markLost = internalMutation({
	args: {
		broadcastId: v.id("broadcasts"),
	},
	returns: v.null(),
	handler: async (ctx, args: HeartbeatExpiryArgs) =>
		await markBroadcastLost(ctx, args),
});
