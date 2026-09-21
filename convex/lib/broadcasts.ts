import type { FunctionReference } from "convex/server";
import { Schema } from "effect";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireCurrentOperatorId, Unauthorized } from "./auth";
import {
	getOwnedSession,
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
	if (transition.kind === "abandon" && state.status !== "lost") {
		return { kind: "invalid", reason: "not_lost" };
	}
	if (state.status === "stopping") return { kind: "checkDrain" };
	if (transition.kind === "stop" && state.status === "lost") {
		return { kind: "invalid", reason: "not_active" };
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

async function getOwnedBroadcast(
	ctx: BroadcastCtx,
	broadcastId: Id<"broadcasts">,
	ownerId: Id<"users">,
) {
	const broadcast = await ctx.db.get("broadcasts", broadcastId);
	if (!broadcast) {
		throw new BroadcastNotFound({ message: "Broadcast not found" });
	}

	const session = await ctx.db.get("sessions", broadcast.sessionId);
	if (!session) {
		throw new SessionNotFound({ message: "Session not found" });
	}
	if (session.ownerId !== ownerId) {
		throw new Unauthorized({ message: "Unauthorized" });
	}
	return assertValidBroadcastState(broadcast);
}

export async function getUnresolvedBroadcast(
	ctx: BroadcastCtx,
	sessionId: Id<"sessions">,
) {
	return await readUnresolvedBroadcast(ctx, sessionId);
}

export async function getBroadcastProjection(
	ctx: BroadcastCtx,
	sessionId: Id<"sessions">,
	audience: BroadcastProjectionAudience,
) {
	const broadcast = await getUnresolvedBroadcast(ctx, sessionId);
	return projectBroadcast(broadcast, audience);
}

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

export async function maybeSealBroadcast(
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = await ctx.db.get("broadcasts", broadcastId);
	if (broadcast) assertValidBroadcastState(broadcast);
	if (
		broadcast?.status !== "stopping" ||
		broadcast.finalCommitOrdinal === undefined
	) {
		return broadcast;
	}

	if (!isBroadcastDrained(broadcast, broadcast.finalCommitOrdinal)) {
		return broadcast;
	}

	const sealedAt = Date.now();
	await ctx.db.patch(broadcastId, { status: "sealed", sealedAt });
	return await ctx.db.get("broadcasts", broadcastId);
}

export async function finishCommitDrain(
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const broadcast = await ctx.db.get("broadcasts", broadcastId);
	if (!broadcast) {
		throw new Error("Accepted commit references a missing Broadcast");
	}
	assertValidBroadcastState(broadcast);
	if (broadcast.pendingCommitCount <= 0) {
		throw new Error("Broadcast pending commit count underflow");
	}
	await ctx.db.patch(broadcastId, {
		pendingCommitCount: broadcast.pendingCommitCount - 1,
	});
	return await maybeSealBroadcast(ctx, broadcastId);
}

export type HeartbeatExpiryArgs = {
	broadcastId: Id<"broadcasts">;
};

const markLostReference: FunctionReference<
	"mutation",
	"internal",
	HeartbeatExpiryArgs,
	null
> = internal.broadcasts.markLost;

async function scheduleHeartbeatExpiry(
	ctx: MutationCtx,
	args: HeartbeatExpiryArgs,
	delayMs: number,
) {
	await ctx.scheduler.runAfter(Math.max(0, delayMs), markLostReference, args);
}

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

export async function startBroadcast(
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const session = await getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}

	const unresolved = await getUnresolvedBroadcast(ctx, sessionId);
	if (unresolved) {
		throw new SessionBusy({
			message: "The Session already has an unresolved Broadcast",
		});
	}

	const sequence = session.lastBroadcastSequence + 1;
	const startedAt = Date.now();
	const broadcastId = await ctx.db.insert("broadcasts", {
		sessionId,
		sequence,
		status: "active",
		startedAt,
		lastHeartbeatAt: startedAt,
		lastCommitOrdinal: 0,
		pendingCommitCount: 0,
	});
	await ctx.db.patch(sessionId, {
		lastBroadcastSequence: sequence,
		lastActivityAt: startedAt,
	});
	await scheduleHeartbeatExpiry(
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
}

export async function sendHeartbeat(
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const broadcast = await getOwnedBroadcast(ctx, broadcastId, ownerId);
	if (broadcast.status !== "active") return null;
	const lastHeartbeatAt = Date.now();
	const decision = classifyBroadcastTransition(
		{ ...broadcast, lastHeartbeatAt: broadcast.lastHeartbeatAt },
		{ kind: "heartbeatExpired", now: lastHeartbeatAt },
	);
	if (decision.kind === "markLost") {
		await ctx.db.patch(broadcastId, { status: "lost" });
		return null;
	}
	if (decision.kind === "invalid") {
		throw new Error("Invalid Broadcast lifecycle state");
	}
	if (decision.kind !== "reschedule") return null;
	await ctx.db.patch(broadcastId, { lastHeartbeatAt });
	return null;
}

export async function markBroadcastLost(
	ctx: MutationCtx,
	args: HeartbeatExpiryArgs,
) {
	const broadcast = await ctx.db.get("broadcasts", args.broadcastId);
	if (!broadcast) return null;

	const now = Date.now();
	const decision = classifyBroadcastTransition(
		{ ...broadcast, lastHeartbeatAt: broadcast.lastHeartbeatAt },
		{ kind: "heartbeatExpired", now },
	);
	if (decision.kind === "reschedule") {
		await scheduleHeartbeatExpiry(
			ctx,
			{ broadcastId: args.broadcastId },
			decision.delayMs,
		);
		return null;
	}
	if (decision.kind === "invalid") {
		throw new Error("Invalid Broadcast lifecycle state");
	}
	if (decision.kind !== "markLost") return null;

	await ctx.db.patch(args.broadcastId, { status: "lost" });
	return null;
}

export async function resumeBroadcast(
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const broadcast = await getOwnedBroadcast(ctx, broadcastId, ownerId);
	const decision = classifyBroadcastTransition(broadcast, { kind: "resume" });
	if (decision.kind === "invalid") {
		if (decision.reason === "invalid_state") {
			throw new Error("Invalid Broadcast lifecycle state");
		}
		throw transitionError(
			decision.reason,
			"Only a Lost Broadcast can be resumed",
		);
	}
	if (decision.kind === "noop") return toBroadcastResult(broadcast);

	const session = await getOwnedSession(ctx, broadcast.sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}
	const lastHeartbeatAt = Date.now();
	await ctx.db.patch(broadcastId, {
		status: "active",
		lastHeartbeatAt,
	});
	await scheduleHeartbeatExpiry(
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
}

type TerminalBroadcastTransition =
	| {
			kind: "stop";
			broadcastId: Id<"broadcasts">;
			finalCommitOrdinal?: number;
	  }
	| {
			kind: "abandon";
			broadcastId: Id<"broadcasts">;
	  };

async function terminalBroadcastTransition(
	ctx: MutationCtx,
	args: TerminalBroadcastTransition,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const broadcast = await getOwnedBroadcast(ctx, args.broadcastId, ownerId);
	const finalCommitOrdinal =
		args.kind === "stop" && args.finalCommitOrdinal !== undefined
			? validateFinalCommitOrdinal(args.finalCommitOrdinal)
			: broadcast.lastCommitOrdinal;
	const decision = classifyBroadcastTransition(broadcast, {
		kind: args.kind,
		finalCommitOrdinal,
	});

	if (decision.kind === "noop") return toBroadcastResult(broadcast);
	if (decision.kind === "checkDrain") {
		const sealed = await maybeSealBroadcast(ctx, args.broadcastId);
		return toBroadcastResult(sealed ?? broadcast);
	}
	if (decision.kind === "invalid") {
		if (decision.reason === "invalid_state") {
			throw new Error("Invalid Broadcast lifecycle state");
		}
		throw transitionError(
			decision.reason,
			args.kind === "abandon"
				? "Only a Lost Broadcast can be abandoned"
				: undefined,
		);
	}
	if (decision.kind !== "transition") {
		throw new Error("Invalid Broadcast transition decision");
	}

	const session = await getOwnedSession(ctx, broadcast.sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}
	const stoppedAt = Date.now();
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
	await ctx.db.patch(args.broadcastId, patch);
	await ctx.db.patch(broadcast.sessionId, { lastActivityAt: stoppedAt });
	return toBroadcastResult({ ...broadcast, ...patch });
}

export async function abandonBroadcast(
	ctx: MutationCtx,
	broadcastId: Id<"broadcasts">,
) {
	return await terminalBroadcastTransition(ctx, {
		kind: "abandon",
		broadcastId,
	});
}

export async function stopBroadcast(
	ctx: MutationCtx,
	args: {
		broadcastId: Id<"broadcasts">;
		finalCommitOrdinal?: number;
	},
) {
	return await terminalBroadcastTransition(ctx, { kind: "stop", ...args });
}

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
	try {
		return Schema.decodeUnknownSync(positiveCommitOrdinalSchema)(value);
	} catch {
		throw new InvalidCommitOrdinal({
			message: "Commit ordinal must be a positive integer",
		});
	}
}

export function validateFinalCommitOrdinal(value: unknown) {
	try {
		return Schema.decodeUnknownSync(Schema.Natural)(value);
	} catch {
		throw new InvalidCommitOrdinal({
			message: "Final commit ordinal must be a non-negative integer",
		});
	}
}
