import { Effect, Schema } from "effect";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fromConvex } from "../effect/convex";
import { getOperator, Unauthorized } from "./auth";
import { nowMillis, SessionNotFound } from "./sessions";

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

const unresolvedBroadcastStatuses = ["active", "lost", "stopping"] as const;

const positiveCommitOrdinalSchema = Schema.Int.check(Schema.isGreaterThan(0));

type BroadcastCtx = QueryCtx | MutationCtx;

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
	return broadcast;
});

export const getUnresolvedBroadcast = Effect.fn("Broadcasts.getUnresolved")(
	function* (ctx: BroadcastCtx, sessionId: Id<"sessions">) {
		for (const status of unresolvedBroadcastStatuses) {
			const broadcast = yield* fromConvex(
				() =>
					ctx.db
						.query("broadcasts")
						.withIndex("by_session_id_and_status", (q) =>
							q.eq("sessionId", sessionId).eq("status", status),
						)
						.first(),
				`Broadcasts.getUnresolved.${status}`,
			);
			if (broadcast) return broadcast;
		}
		return null;
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
