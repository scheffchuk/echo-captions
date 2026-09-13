import { Clock, Effect, Schema } from "effect";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fromConvex } from "../effect/convex";
import { Unauthorized } from "./auth";

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()(
	"SessionNotFound",
	{ message: Schema.String },
) {}

export class SessionDeleting extends Schema.TaggedError<SessionDeleting>()(
	"SessionDeleting",
	{ message: Schema.String },
) {}

export class SessionBusy extends Schema.TaggedError<SessionBusy>()(
	"SessionBusy",
	{ message: Schema.String },
) {}

export class InvalidSessionTransition extends Schema.TaggedError<InvalidSessionTransition>()(
	"InvalidSessionTransition",
	{ message: Schema.String },
) {}

export const sessionErrorCodes = {
	InvalidSessionTransition: "invalid_session_transition",
	SessionBusy: "session_busy",
	SessionDeleting: "session_deleting",
	SessionNotFound: "session_not_found",
} as const;

export const getOwnedSession = Effect.fn("Sessions.getOwned")(function* (
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"sessions">,
	ownerId: Id<"users">,
) {
	const session = yield* fromConvex(
		() => ctx.db.get("sessions", sessionId),
		"Sessions.getOwned",
	);
	if (!session) {
		return yield* new SessionNotFound({ message: "Session not found" });
	}
	if (session.ownerId !== ownerId) {
		return yield* new Unauthorized({ message: "Unauthorized" });
	}
	return session;
});

export function generateSlug(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let slug = "";
	for (let i = 0; i < 8; i++) {
		slug += chars[Math.floor(Math.random() * chars.length)];
	}
	return slug;
}

export const uniqueSessionSlug = Effect.fn("Sessions.uniqueSlug")(function* (
	ctx: MutationCtx,
) {
	while (true) {
		const slug = generateSlug();
		const existingSession = yield* fromConvex(
			() =>
				ctx.db
					.query("sessions")
					.withIndex("by_slug", (q) => q.eq("slug", slug))
					.unique(),
			"Sessions.uniqueSlug",
		);
		const existingReservation = yield* fromConvex(
			() =>
				ctx.db
					.query("sessionSlugs")
					.withIndex("by_slug", (q) => q.eq("slug", slug))
					.unique(),
			"Sessions.uniqueSlug.reservation",
		);
		if (!existingSession && !existingReservation) {
			return slug;
		}
	}
});

export const nowMillis = Effect.fn("Sessions.nowMillis")(function* () {
	return yield* Clock.currentTimeMillis;
});
