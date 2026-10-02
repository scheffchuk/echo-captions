import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function getOwnedSession(
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"sessions">,
	ownerId: Id<"users">,
) {
	const session = await ctx.db.get("sessions", sessionId);

	if (!session) {
		throw new ConvexError({
			code: "session_not_found",
			message: "Session not found",
		});
	}

	if (session.ownerId !== ownerId) {
		throw new ConvexError({ code: "unauthorized", message: "Unauthorized" });
	}

	return session;
}

export async function getAvailableOwnedSession(
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"sessions">,
	ownerId: Id<"users">,
) {
	const session = await getOwnedSession(ctx, sessionId, ownerId);

	if (session.deletionRequestedAt !== undefined) {
		throw new ConvexError({
			code: "session_deleting",
			message: "Session is being deleted",
		});
	}

	return session;
}

function generateSlug(): string {
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
