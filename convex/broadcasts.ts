import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { Effect } from "effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
} from "./_generated/server";
import { exhaustPublicErrors, fromConvex } from "./effect/convex";
import { runConvex } from "./effect/run";
import { authErrorCodes, getOperator } from "./lib/auth";
import {
	BROADCAST_HEARTBEAT_TIMEOUT_MS,
	BroadcastConflict,
	BroadcastNotActive,
	BroadcastNotLost,
	broadcastErrorCodes,
	getOwnedBroadcast,
	getUnresolvedBroadcast,
	isBroadcastDrained,
	maybeSealBroadcast,
	validateFinalCommitOrdinal,
} from "./lib/broadcasts";
import {
	getOwnedSession,
	nowMillis,
	SessionBusy,
	SessionDeleting,
	sessionErrorCodes,
} from "./lib/sessions";
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

type HeartbeatExpiryArgs = {
	broadcastId: Id<"broadcasts">;
};

const markLostReference: FunctionReference<
	"mutation",
	"internal",
	HeartbeatExpiryArgs,
	null
> = internal.broadcasts.markLost;

const scheduleHeartbeatExpiry = Effect.fn("Broadcasts.scheduleExpiry")(
	function* (ctx: MutationCtx, args: HeartbeatExpiryArgs, delayMs: number) {
		yield* fromConvex(
			() =>
				ctx.scheduler.runAfter(Math.max(0, delayMs), markLostReference, args),
			"Broadcasts.scheduleExpiry",
		);
		return null;
	},
);

const startBroadcast = Effect.fn("Broadcasts.start")(function* (
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
) {
	const session = yield* getOwnedSession(
		ctx,
		sessionId,
		yield* getOperator(ctx),
	);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}

	const unresolved = yield* getUnresolvedBroadcast(ctx, sessionId);
	if (unresolved) {
		return yield* new SessionBusy({
			message: "The Session already has an unresolved Broadcast",
		});
	}

	const sequence = session.lastBroadcastSequence + 1;
	const startedAt = yield* nowMillis();
	const broadcastId = yield* fromConvex(
		() =>
			ctx.db.insert("broadcasts", {
				sessionId,
				sequence,
				status: "active",
				startedAt,
				lastHeartbeatAt: startedAt,
				lastCommitOrdinal: 0,
				pendingCommitCount: 0,
			}),
		"Broadcasts.start.insert",
	);
	yield* fromConvex(
		() =>
			ctx.db.patch(sessionId, {
				lastBroadcastSequence: sequence,
				lastActivityAt: startedAt,
			}),
		"Broadcasts.start.updateSession",
	);
	yield* scheduleHeartbeatExpiry(
		ctx,
		{
			broadcastId,
		},
		BROADCAST_HEARTBEAT_TIMEOUT_MS,
	);

	return {
		broadcastId,
		sequence,
		status: "active" as const,
		lastCommitOrdinal: 0,
	};
});

const sendHeartbeat = Effect.fn("Broadcasts.heartbeat")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* getOwnedBroadcast(ctx, broadcastId);
	if (broadcast.status !== "active") return null;
	const lastHeartbeatAt = yield* nowMillis();
	if (
		lastHeartbeatAt - broadcast.lastHeartbeatAt >=
		BROADCAST_HEARTBEAT_TIMEOUT_MS
	) {
		yield* fromConvex(
			() => ctx.db.patch(broadcastId, { status: "lost" }),
			"Broadcasts.heartbeat.markLost",
		);
		return null;
	}
	yield* fromConvex(
		() => ctx.db.patch(broadcastId, { lastHeartbeatAt }),
		"Broadcasts.heartbeat.patch",
	);
	return null;
});

const markBroadcastLost = Effect.fn("Broadcasts.markLost")(function* (
	ctx: MutationCtx,
	args: HeartbeatExpiryArgs,
) {
	const broadcast = yield* fromConvex(
		() => ctx.db.get("broadcasts", args.broadcastId),
		"Broadcasts.markLost.get",
	);
	if (broadcast?.status !== "active") return null;

	const now = yield* nowMillis();
	const remaining =
		BROADCAST_HEARTBEAT_TIMEOUT_MS - (now - broadcast.lastHeartbeatAt);
	if (remaining > 0) {
		yield* scheduleHeartbeatExpiry(
			ctx,
			{ broadcastId: args.broadcastId },
			remaining,
		);
		return null;
	}

	yield* fromConvex(
		() => ctx.db.patch(args.broadcastId, { status: "lost" }),
		"Broadcasts.markLost.patch",
	);
	return null;
});

const resumeBroadcast = Effect.fn("Broadcasts.resume")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* getOwnedBroadcast(ctx, broadcastId);
	if (broadcast.status === "active") return toBroadcastResult(broadcast);
	if (broadcast.status !== "lost") {
		return yield* new BroadcastNotLost({
			message: "Only a Lost Broadcast can be resumed",
		});
	}
	const session = yield* getOwnedSession(
		ctx,
		broadcast.sessionId,
		yield* getOperator(ctx),
	);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	const lastHeartbeatAt = yield* nowMillis();
	yield* fromConvex(
		() =>
			ctx.db.patch(broadcastId, {
				status: "active",
				lastHeartbeatAt,
			}),
		"Broadcasts.resume.patch",
	);
	yield* scheduleHeartbeatExpiry(
		ctx,
		{ broadcastId },
		BROADCAST_HEARTBEAT_TIMEOUT_MS,
	);
	return toBroadcastResult({
		_id: broadcast._id,
		sequence: broadcast.sequence,
		status: "active",
		lastCommitOrdinal: broadcast.lastCommitOrdinal,
		finalCommitOrdinal: broadcast.finalCommitOrdinal,
	});
});

const abandonBroadcast = Effect.fn("Broadcasts.abandon")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* getOwnedBroadcast(ctx, broadcastId);
	if (broadcast.status === "sealed") return toBroadcastResult(broadcast);
	if (broadcast.status === "stopping") {
		const sealed = yield* maybeSealBroadcast(ctx, broadcastId);
		return toBroadcastResult(sealed ?? broadcast);
	}
	if (broadcast.status !== "lost") {
		return yield* new BroadcastNotLost({
			message: "Only a Lost Broadcast can be abandoned",
		});
	}
	const session = yield* getOwnedSession(
		ctx,
		broadcast.sessionId,
		yield* getOperator(ctx),
	);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	const stoppedAt = yield* nowMillis();
	const status =
		broadcast.pendingCommitCount === 0
			? ("sealed" as const)
			: ("stopping" as const);
	const patch =
		status === "sealed"
			? {
					status,
					finalCommitOrdinal: broadcast.lastCommitOrdinal,
					sealedAt: stoppedAt,
				}
			: {
					status,
					finalCommitOrdinal: broadcast.lastCommitOrdinal,
				};
	yield* fromConvex(
		() => ctx.db.patch(broadcastId, patch),
		"Broadcasts.abandon.patch",
	);
	yield* fromConvex(
		() => ctx.db.patch(broadcast.sessionId, { lastActivityAt: stoppedAt }),
		"Broadcasts.abandon.updateSession",
	);
	return {
		broadcastId,
		sequence: broadcast.sequence,
		status,
		lastCommitOrdinal: broadcast.lastCommitOrdinal,
		finalCommitOrdinal: broadcast.lastCommitOrdinal,
	};
});

const stopBroadcast = Effect.fn("Broadcasts.stop")(function* (
	ctx: MutationCtx,
	args: {
		broadcastId: Id<"broadcasts">;
		finalCommitOrdinal?: number;
	},
) {
	const broadcast = yield* getOwnedBroadcast(ctx, args.broadcastId);
	const finalCommitOrdinal =
		args.finalCommitOrdinal === undefined
			? broadcast.lastCommitOrdinal
			: yield* validateFinalCommitOrdinal(args.finalCommitOrdinal);
	if (
		finalCommitOrdinal !== broadcast.lastCommitOrdinal ||
		(broadcast.finalCommitOrdinal !== undefined &&
			broadcast.finalCommitOrdinal !== finalCommitOrdinal)
	) {
		return yield* new BroadcastConflict({
			message: "Final commit ordinal conflicts with the Broadcast state",
		});
	}

	if (broadcast.status === "sealed") {
		return toBroadcastResult(broadcast);
	}
	if (broadcast.status === "stopping") {
		const sealed = yield* maybeSealBroadcast(ctx, args.broadcastId);
		return toBroadcastResult(sealed ?? broadcast);
	}
	if (broadcast.status === "lost") {
		return yield* new BroadcastNotActive({
			message: "Resume or abandon the Lost Broadcast before stopping it",
		});
	}

	const session = yield* getOwnedSession(
		ctx,
		broadcast.sessionId,
		yield* getOperator(ctx),
	);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	const stoppedAt = yield* nowMillis();
	const drained = isBroadcastDrained(broadcast, finalCommitOrdinal);
	const status = drained ? ("sealed" as const) : ("stopping" as const);
	const patch = drained
		? {
				status,
				finalCommitOrdinal,
				sealedAt: stoppedAt,
			}
		: {
				status,
				finalCommitOrdinal,
			};
	yield* fromConvex(
		() => ctx.db.patch(args.broadcastId, patch),
		"Broadcasts.stop.patch",
	);
	yield* fromConvex(
		() => ctx.db.patch(broadcast.sessionId, { lastActivityAt: stoppedAt }),
		"Broadcasts.stop.updateSession",
	);

	return {
		broadcastId: args.broadcastId,
		sequence: broadcast.sequence,
		status,
		lastCommitOrdinal: broadcast.lastCommitOrdinal,
		finalCommitOrdinal,
	};
});

function toBroadcastResult(
	broadcast: {
		_id: Id<"broadcasts">;
		sequence: number;
		status: "active" | "lost" | "stopping" | "sealed";
		lastCommitOrdinal: number;
		finalCommitOrdinal?: number;
	} | null,
) {
	if (!broadcast) {
		throw new Error("Broadcast disappeared during stop");
	}
	return {
		broadcastId: broadcast._id,
		sequence: broadcast.sequence,
		status: broadcast.status,
		lastCommitOrdinal: broadcast.lastCommitOrdinal,
		finalCommitOrdinal: broadcast.finalCommitOrdinal,
	};
}

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
	handler: (ctx, args) =>
		runConvex(markBroadcastLost(ctx, args).pipe(Effect.orDie)),
});
