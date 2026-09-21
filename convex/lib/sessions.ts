import { Schema } from "effect";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
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

export async function getOwnedSession(
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"sessions">,
	ownerId: Id<"users">,
) {
	const session = await ctx.db.get("sessions", sessionId);
	if (!session) {
		throw new SessionNotFound({ message: "Session not found" });
	}
	if (session.ownerId !== ownerId) {
		throw new Unauthorized({ message: "Unauthorized" });
	}
	return session;
}

export function generateSlug(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let slug = "";
	for (let i = 0; i < 8; i++) {
		slug += chars[Math.floor(Math.random() * chars.length)];
	}
	return slug;
}

export async function uniqueSessionSlug(ctx: MutationCtx): Promise<string> {
	while (true) {
		const slug = generateSlug();
		const existingSession = await ctx.db
			.query("sessions")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.unique();
		const existingReservation = await ctx.db
			.query("sessionSlugs")
			.withIndex("by_slug", (q) => q.eq("slug", slug))
			.unique();
		if (!existingSession && !existingReservation) {
			return slug;
		}
	}
}
