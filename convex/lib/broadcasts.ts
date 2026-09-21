import type { FunctionReference } from "convex/server";
import { Effect, Schema } from "effect";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fromConvex } from "../effect/convex";
import { getOperator, Unauthorized } from "./auth";
import {
	getOwnedSession,
	nowMillis,
	SessionBusy,
	SessionDeleting,
	SessionNotFound,
} from "./sessions";

export type BroadcastStatus = "active" | "lost" | "stopping" | "sealed";

export class BroadcastNotFound extends Schema.TaggedError<BroadcastNotFound>()(
	"BroadcastNotFound",
	{ message: Schema.String },
) {}

export class BroadcastNotActive extends Schema.TaggedError<BroadcastNotActive>()(
	"BroadcastNotActive",
	{ message: Schema.String },
) {}

export class BroadcastNotLost extends Schema.TaggedError<BroadcastNotLost>()(
	"BroadcastNotLost",
	{ message: Schema.String },
) {}

export class BroadcastConflict extends Schema.TaggedError<BroadcastConflict>()(
	"BroadcastConflict",
	{ message: Schema.String },
) {}

export class InvalidCommitOrdinal extends Schema.TaggedError<InvalidCommitOrdinal>()(
	"InvalidCommitOrdinal",
	{ message: Schema.String },
) {}

export const broadcastErrorCodes = {
	BroadcastConflict: "broadcast_conflict",
	BroadcastNotActive: "broadcast_not_active",
	BroadcastNotLost: "broadcast_not_lost",
	BroadcastNotFound: "broadcast_not_found",
	InvalidCommitOrdinal: "invalid_commit_ordinal",
} as const;

export const BROADCAST_HEARTBEAT_INTERVAL_MS = 5_000;
export const BROADCAST_HEARTBEAT_TIMEOUT_MS = 20_000;

export const unresolvedBroadcastStatuses = [
	"active",
	"lost",
	"stopping",
] as const satisfies readonly BroadcastStatus[];

const positiveCommitOrdinalSchema = Schema.Int.check(Schema.isGreaterThan(0));

type BroadcastCtx = QueryCtx | MutationCtx;

export type BroadcastLifecycleState = Pick<
	Doc<"broadcasts">,
	"status" | "lastCommitOrdinal" | "pendingCommitCount" | "finalCommitOrdinal"
> & {
	lastHeartbeatAt?: number;
};

export type BroadcastTransition =
	| { kind: "resume" }
	| { kind: "stop"; finalCommitOrdinal: number }
	| { kind: "abandon"; finalCommitOrdinal: number }
	| { kind: "heartbeatExpired"; now: number };

export type BroadcastTransitionDecision =
	| { kind: "noop" }
	| { kind: "resume" }
	| { kind: "markLost" }
	| { kind: "reschedule"; delayMs: number }
	| { kind: "checkDrain" }
	| {
			kind: "transition";
			status: "stopping" | "sealed";
			finalCommitOrdinal: number;
	  }
	| {
			kind: "invalid";
			reason: "not_lost" | "not_active" | "conflict" | "invalid_state";
	  };

function broadcastStateError(state: BroadcastLifecycleState) {
	if (state.pendingCommitCount < 0) {
		return "Broadcast pending commit count is negative";
	}

	const hasFinalCommitOrdinal = state.finalCommitOrdinal !== undefined;
	const isFinalized = state.status === "stopping" || state.status === "sealed";
	if (hasFinalCommitOrdinal !== isFinalized) {
		return "Broadcast final commit ordinal does not match its status";
	}
	if (
		hasFinalCommitOrdinal &&
		state.finalCommitOrdinal !== state.lastCommitOrdinal
	) {
		return "Broadcast final commit ordinal does not match its last commit ordinal";
	}
	if (state.status === "sealed" && state.pendingCommitCount !== 0) {
		return "Sealed Broadcast still has pending commits";
	}
	return null;
}

function validateBroadcastState(broadcast: Doc<"broadcasts">) {
	const error = broadcastStateError(broadcast);
	return error === null
		? Effect.succeed(broadcast)
		: Effect.die(new Error(error));
}

export function classifyBroadcastTransition(
	state: BroadcastLifecycleState,
	transition: BroadcastTransition,
): BroadcastTransitionDecision {
	if (broadcastStateError(state) !== null) {
		return { kind: "invalid", reason: "invalid_state" };
	}

	if (transition.kind === "resume") {
		if (state.status === "active") return { kind: "noop" };
		if (state.status === "lost") return { kind: "resume" };
		return { kind: "invalid", reason: "not_lost" };
	}

	if (transition.kind === "heartbeatExpired") {
		if (state.status !== "active") return { kind: "noop" };
		if (state.lastHeartbeatAt === undefined) {
			return { kind: "invalid", reason: "invalid_state" };
		}
		const delayMs =
			BROADCAST_HEARTBEAT_TIMEOUT_MS - (transition.now - state.lastHeartbeatAt);
		return delayMs > 0 ? { kind: "reschedule", delayMs } : { kind: "markLost" };
	}

	if (
		transition.finalCommitOrdinal !== state.lastCommitOrdinal ||
		(state.finalCommitOrdinal !== undefined &&
			state.finalCommitOrdinal !== transition.finalCommitOrdinal)
	) {
		return { kind: "invalid", reason: "conflict" };
	}

	if (state.status === "sealed") return { kind: "noop" };
	if (state.status === "stopping") return { kind: "checkDrain" };
	if (transition.kind === "stop" && state.status === "lost") {
		return { kind: "invalid", reason: "not_active" };
	}
	if (transition.kind === "abandon" && state.status !== "lost") {
		return { kind: "invalid", reason: "not_lost" };
	}

	return {
		kind: "transition",
		status: isBroadcastDrained(state, transition.finalCommitOrdinal)
			? "sealed"
			: "stopping",
		finalCommitOrdinal: transition.finalCommitOrdinal,
	};
}

export type BroadcastProjectionAudience = "public" | "owner";

export type BroadcastView = Pick<
	Doc<"broadcasts">,
	"_id" | "sequence" | "status" | "lastCommitOrdinal" | "finalCommitOrdinal"
>;

function toBroadcastView(broadcast: BroadcastView): BroadcastView {
	return {
		_id: broadcast._id,
		sequence: broadcast.sequence,
		status: broadcast.status,
		lastCommitOrdinal: broadcast.lastCommitOrdinal,
		finalCommitOrdinal: broadcast.finalCommitOrdinal,
	};
}

export function projectBroadcast(
	broadcast: BroadcastView | null,
	audience: BroadcastProjectionAudience,
) {
	const visibleBroadcast =
		audience === "owner" && broadcast?.status !== "sealed"
			? broadcast
			: audience === "public" && broadcast?.status === "active"
				? broadcast
				: null;
	return {
		isLive: visibleBroadcast?.status === "active",
		activeBroadcast: visibleBroadcast
			? toBroadcastView(visibleBroadcast)
			: null,
	};
}

export function assertValidBroadcastState(
	broadcast: Doc<"broadcasts">,
): Doc<"broadcasts"> {
	const error = broadcastStateError(broadcast);
	if (error !== null) {
		throw new Error(error);
	}
	return broadcast;
}

async function readUnresolvedBroadcast(
	ctx: BroadcastCtx,
	sessionId: Id<"sessions">,
): Promise<Doc<"broadcasts"> | null> {
	let unresolved: Doc<"broadcasts"> | null = null;
	for (const status of unresolvedBroadcastStatuses) {
		const broadcasts = await ctx.db
			.query("broadcasts")
			.withIndex("by_session_id_and_status", (q) =>
				q.eq("sessionId", sessionId).eq("status", status),
			)
			.take(2);
		if (broadcasts.length > 1) {
			throw new Error(
				"Session has multiple Broadcasts in one unresolved state",
			);
		}
		if (broadcasts[0]) {
			if (unresolved) {
				throw new Error("Session has multiple unresolved Broadcasts");
			}
			unresolved = assertValidBroadcastState(broadcasts[0]);
		}
	}
	return unresolved;
}

export async function readBroadcastProjection(
	ctx: BroadcastCtx,
	sessionId: Id<"sessions">,
	audience: BroadcastProjectionAudience,
) {
	const unresolved = await readUnresolvedBroadcast(ctx, sessionId);
	return projectBroadcast(unresolved, audience);
}

export const getOwnedBroadcast = Effect.fn("Broadcasts.getOwned")(function* (
	ctx: BroadcastCtx,
	broadcastId: Id<"broadcasts">,
) {
	const ownerId = yield* getOperator(ctx);
	const broadcast = yield* fromConvex(
		() => ctx.db.get("broadcasts", broadcastId),
		"Broadcasts.getOwned",
	);
	if (!broadcast) {
		return yield* new BroadcastNotFound({ message: "Broadcast not found" });
	}

	const session = yield* fromConvex(
		() => ctx.db.get("sessions", broadcast.sessionId),
		"Broadcasts.getOwnedSession",
	);
	if (!session) {
		return yield* new SessionNotFound({ message: "Session not found" });
	}
	if (session.ownerId !== ownerId) {
		return yield* new Unauthorized({ message: "Unauthorized" });
	}
	return yield* validateBroadcastState(broadcast);
});

export const getUnresolvedBroadcast = Effect.fn("Broadcasts.getUnresolved")(
	function* (ctx: BroadcastCtx, sessionId: Id<"sessions">) {
		return yield* fromConvex(
			() => readUnresolvedBroadcast(ctx, sessionId),
			"Broadcasts.getUnresolved",
		);
	},
);

export const getBroadcastProjection = Effect.fn("Broadcasts.getProjection")(
	function* (
		ctx: BroadcastCtx,
		sessionId: Id<"sessions">,
		audience: BroadcastProjectionAudience,
	) {
		const broadcast = yield* getUnresolvedBroadcast(ctx, sessionId);
		return projectBroadcast(broadcast, audience);
	},
);

export function isBroadcastDrained(
	broadcast: Pick<
		Doc<"broadcasts">,
		"lastCommitOrdinal" | "pendingCommitCount"
	>,
	finalCommitOrdinal: number,
) {
	return (
		finalCommitOrdinal <= broadcast.lastCommitOrdinal &&
		broadcast.pendingCommitCount === 0
	);
}

export const maybeSealBroadcast = Effect.fn("Broadcasts.maybeSeal")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* fromConvex(
		() => ctx.db.get("broadcasts", broadcastId),
		"Broadcasts.maybeSeal.get",
	);
	if (broadcast) yield* validateBroadcastState(broadcast);
	if (
		broadcast?.status !== "stopping" ||
		broadcast.finalCommitOrdinal === undefined
	) {
		return broadcast;
	}

	if (!isBroadcastDrained(broadcast, broadcast.finalCommitOrdinal)) {
		return broadcast;
	}

	const sealedAt = yield* nowMillis();
	yield* fromConvex(
		() => ctx.db.patch(broadcastId, { status: "sealed", sealedAt }),
		"Broadcasts.maybeSeal.patch",
	);
	return yield* fromConvex(
		() => ctx.db.get("broadcasts", broadcastId),
		"Broadcasts.maybeSeal.getSealed",
	);
});

export const finishCommitDrain = Effect.fn("Broadcasts.finishCommitDrain")(
	function* (ctx: MutationCtx, broadcastId: Id<"broadcasts">) {
		const broadcast = yield* fromConvex(
			() => ctx.db.get("broadcasts", broadcastId),
			"Broadcasts.finishCommitDrain.get",
		);
		if (!broadcast) {
			return yield* Effect.die(
				new Error("Accepted commit references a missing Broadcast"),
			);
		}
		yield* validateBroadcastState(broadcast);
		if (broadcast.pendingCommitCount <= 0) {
			return yield* Effect.die(
				new Error("Broadcast pending commit count underflow"),
			);
		}
		yield* fromConvex(
			() =>
				ctx.db.patch(broadcastId, {
					pendingCommitCount: broadcast.pendingCommitCount - 1,
				}),
			"Broadcasts.finishCommitDrain.decrement",
		);
		return yield* maybeSealBroadcast(ctx, broadcastId);
	},
);

export type HeartbeatExpiryArgs = {
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

function transitionError(
	reason: Exclude<
		Extract<BroadcastTransitionDecision, { kind: "invalid" }>["reason"],
		"invalid_state"
	>,
	notLostMessage = "Only a Lost Broadcast can be resumed or abandoned",
) {
	if (reason === "conflict") {
		return new BroadcastConflict({
			message: "Final commit ordinal conflicts with the Broadcast state",
		});
	}
	if (reason === "not_active") {
		return new BroadcastNotActive({
			message: "Resume or abandon the Lost Broadcast before stopping it",
		});
	}
	return new BroadcastNotLost({
		message: notLostMessage,
	});
}

export const startBroadcast = Effect.fn("Broadcasts.start")(function* (
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
		{ broadcastId },
		BROADCAST_HEARTBEAT_TIMEOUT_MS,
	);

	return {
		broadcastId,
		sequence,
		status: "active" as const,
		lastCommitOrdinal: 0,
	};
});

export const sendHeartbeat = Effect.fn("Broadcasts.heartbeat")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* getOwnedBroadcast(ctx, broadcastId);
	if (broadcast.status !== "active") return null;
	const lastHeartbeatAt = yield* nowMillis();
	const decision = classifyBroadcastTransition(
		{ ...broadcast, lastHeartbeatAt: broadcast.lastHeartbeatAt },
		{ kind: "heartbeatExpired", now: lastHeartbeatAt },
	);
	if (decision.kind === "markLost") {
		yield* fromConvex(
			() => ctx.db.patch(broadcastId, { status: "lost" }),
			"Broadcasts.heartbeat.markLost",
		);
		return null;
	}
	if (decision.kind === "invalid") {
		return yield* Effect.die(new Error("Invalid Broadcast lifecycle state"));
	}
	if (decision.kind !== "reschedule") return null;
	yield* fromConvex(
		() => ctx.db.patch(broadcastId, { lastHeartbeatAt }),
		"Broadcasts.heartbeat.patch",
	);
	return null;
});

export const markBroadcastLost = Effect.fn("Broadcasts.markLost")(function* (
	ctx: MutationCtx,
	args: HeartbeatExpiryArgs,
) {
	const broadcast = yield* fromConvex(
		() => ctx.db.get("broadcasts", args.broadcastId),
		"Broadcasts.markLost.get",
	);
	if (!broadcast) return null;

	const now = yield* nowMillis();
	const decision = classifyBroadcastTransition(
		{ ...broadcast, lastHeartbeatAt: broadcast.lastHeartbeatAt },
		{ kind: "heartbeatExpired", now },
	);
	if (decision.kind === "reschedule") {
		yield* scheduleHeartbeatExpiry(
			ctx,
			{ broadcastId: args.broadcastId },
			decision.delayMs,
		);
		return null;
	}
	if (decision.kind === "invalid") {
		return yield* Effect.die(new Error("Invalid Broadcast lifecycle state"));
	}
	if (decision.kind !== "markLost") return null;

	yield* fromConvex(
		() => ctx.db.patch(args.broadcastId, { status: "lost" }),
		"Broadcasts.markLost.patch",
	);
	return null;
});

export const resumeBroadcast = Effect.fn("Broadcasts.resume")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* getOwnedBroadcast(ctx, broadcastId);
	const decision = classifyBroadcastTransition(broadcast, { kind: "resume" });
	if (decision.kind === "invalid") {
		if (decision.reason === "invalid_state") {
			return yield* Effect.die(new Error("Invalid Broadcast lifecycle state"));
		}
		return yield* transitionError(
			decision.reason,
			"Only a Lost Broadcast can be resumed",
		);
	}
	if (decision.kind === "noop") return toBroadcastResult(broadcast);

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
	});
});

export const abandonBroadcast = Effect.fn("Broadcasts.abandon")(function* (
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = yield* getOwnedBroadcast(ctx, broadcastId);
	const decision = classifyBroadcastTransition(broadcast, {
		kind: "abandon",
		finalCommitOrdinal: broadcast.lastCommitOrdinal,
	});
	if (decision.kind === "noop") return toBroadcastResult(broadcast);
	if (decision.kind === "checkDrain") {
		const sealed = yield* maybeSealBroadcast(ctx, broadcastId);
		return toBroadcastResult(sealed ?? broadcast);
	}
	if (decision.kind === "invalid") {
		if (decision.reason === "invalid_state") {
			return yield* Effect.die(new Error("Invalid Broadcast lifecycle state"));
		}
		return yield* transitionError(
			decision.reason,
			"Only a Lost Broadcast can be abandoned",
		);
	}
	if (decision.kind !== "transition") {
		return yield* Effect.die(
			new Error("Invalid Broadcast transition decision"),
		);
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
	const patch =
		decision.status === "sealed"
			? {
					status: decision.status,
					finalCommitOrdinal: decision.finalCommitOrdinal,
					sealedAt: stoppedAt,
				}
			: {
					status: decision.status,
					finalCommitOrdinal: decision.finalCommitOrdinal,
				};
	yield* fromConvex(
		() => ctx.db.patch(broadcastId, patch),
		"Broadcasts.abandon.patch",
	);
	yield* fromConvex(
		() => ctx.db.patch(broadcast.sessionId, { lastActivityAt: stoppedAt }),
		"Broadcasts.abandon.updateSession",
	);
	return toBroadcastResult({ ...broadcast, ...patch });
});

export const stopBroadcast = Effect.fn("Broadcasts.stop")(function* (
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
	const decision = classifyBroadcastTransition(broadcast, {
		kind: "stop",
		finalCommitOrdinal,
	});
	if (decision.kind === "noop") return toBroadcastResult(broadcast);
	if (decision.kind === "checkDrain") {
		const sealed = yield* maybeSealBroadcast(ctx, args.broadcastId);
		return toBroadcastResult(sealed ?? broadcast);
	}
	if (decision.kind === "invalid") {
		if (decision.reason === "invalid_state") {
			return yield* Effect.die(new Error("Invalid Broadcast lifecycle state"));
		}
		return yield* transitionError(decision.reason);
	}
	if (decision.kind !== "transition") {
		return yield* Effect.die(
			new Error("Invalid Broadcast transition decision"),
		);
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
	const patch =
		decision.status === "sealed"
			? {
					status: decision.status,
					finalCommitOrdinal: decision.finalCommitOrdinal,
					sealedAt: stoppedAt,
				}
			: {
					status: decision.status,
					finalCommitOrdinal: decision.finalCommitOrdinal,
				};
	yield* fromConvex(
		() => ctx.db.patch(args.broadcastId, patch),
		"Broadcasts.stop.patch",
	);
	yield* fromConvex(
		() => ctx.db.patch(broadcast.sessionId, { lastActivityAt: stoppedAt }),
		"Broadcasts.stop.updateSession",
	);
	return toBroadcastResult({ ...broadcast, ...patch });
});

export function toBroadcastResult(
	broadcast: {
		_id: Id<"broadcasts">;
		sequence: number;
		status: BroadcastStatus;
		lastCommitOrdinal: number;
		finalCommitOrdinal?: number;
	} | null,
) {
	if (!broadcast) {
		throw new Error("Broadcast disappeared during lifecycle transition");
	}
	return {
		broadcastId: broadcast._id,
		sequence: broadcast.sequence,
		status: broadcast.status,
		lastCommitOrdinal: broadcast.lastCommitOrdinal,
		finalCommitOrdinal: broadcast.finalCommitOrdinal,
	};
}

export function validateCommitOrdinal(value: unknown) {
	return Schema.decodeUnknownEffect(positiveCommitOrdinalSchema)(value).pipe(
		Effect.mapError(
			() =>
				new InvalidCommitOrdinal({
					message: "Commit ordinal must be a positive integer",
				}),
		),
	);
}

export function validateFinalCommitOrdinal(value: unknown) {
	return Schema.decodeUnknownEffect(Schema.Natural)(value).pipe(
		Effect.mapError(
			() =>
				new InvalidCommitOrdinal({
					message: "Final commit ordinal must be a non-negative integer",
				}),
		),
	);
}
