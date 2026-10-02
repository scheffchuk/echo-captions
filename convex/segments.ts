import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { requireCurrentOperatorId } from "./lib/auth";
import { getAvailableOwnedSession } from "./lib/sessions";

const MAX_TRANSCRIPT_SEGMENTS = 1_000;

const MAX_TRANSCRIPT_CHARS = 100_000;

const segmentValidator = v.object({
	_id: v.id("segments"),
	_creationTime: v.number(),
	sessionId: v.id("sessions"),
	sourceText: v.string(),
	sourceLanguage: v.string(),
	status: v.union(v.literal("translated"), v.literal("failed")),
	translations: v.record(v.string(), v.string()),
	error: v.optional(v.string()),
});

async function readTranscriptText(ctx: QueryCtx, sessionId: Id<"sessions">) {
	const ownerId = await requireCurrentOperatorId(ctx);
	await getAvailableOwnedSession(ctx, sessionId, ownerId);

	const segments = await ctx.db
		.query("segments")
		.withIndex("by_session_id_and_sequence", (q) =>
			q.eq("sessionId", sessionId),
		)
		.order("asc")
		.take(MAX_TRANSCRIPT_SEGMENTS + 1);

	if (segments.length > MAX_TRANSCRIPT_SEGMENTS) {
		throw new ConvexError({
			code: "transcript_too_large",
			message: "Transcript is too large to download",
		});
	}

	const transcript = segments.map((segment) => segment.sourceText).join("\n");

	if (transcript.length > MAX_TRANSCRIPT_CHARS) {
		throw new ConvexError({
			code: "transcript_too_large",
			message: "Transcript is too large to download",
		});
	}

	return transcript;
}

const toPublicSegment = (segment: Doc<"segments">) => {
	const publicSegment = {
		_id: segment._id,
		_creationTime: segment._creationTime,
		sessionId: segment.sessionId,
		sourceText: segment.sourceText,
		sourceLanguage: segment.sourceLanguage,
		status: segment.status,
		translations: segment.translations,
	};

	if (segment.error === undefined) return publicSegment;

	return { ...publicSegment, error: segment.error };
};

export const listBySession = query({
	args: {
		sessionId: v.id("sessions"),
		paginationOpts: paginationOptsValidator,
	},
	returns: paginationResultValidator(segmentValidator),
	handler: async (ctx, args) => {
		const session = await ctx.db.get("sessions", args.sessionId);

		if (!session || session.deletionRequestedAt !== undefined) {
			return {
				page: [],
				isDone: true,
				continueCursor: "",
				pageStatus: null,
				splitCursor: null,
			};
		}

		const page = await ctx.db
			.query("segments")
			.withIndex("by_session_id_and_sequence", (q) =>
				q.eq("sessionId", args.sessionId),
			)
			.order("desc")
			.paginate(args.paginationOpts);

		return { ...page, page: page.page.map(toPublicSegment) };
	},
});

export const transcriptText = query({
	args: { sessionId: v.id("sessions") },
	returns: v.string(),
	handler: async (ctx, args) => readTranscriptText(ctx, args.sessionId),
});
