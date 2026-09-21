import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { Schema } from "effect";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { authErrorCodes, requireCurrentOperatorId } from "./lib/auth";
import {
	getOwnedSession,
	SessionDeleting,
	sessionErrorCodes,
} from "./lib/sessions";

const MAX_TRANSCRIPT_SEGMENTS = 1_000;
const MAX_TRANSCRIPT_CHARS = 100_000;

class TranscriptTooLarge extends Schema.TaggedError<TranscriptTooLarge>()(
	"TranscriptTooLarge",
	{ message: Schema.String },
) {}

const publicErrorCodes = {
	...authErrorCodes,
	...sessionErrorCodes,
	TranscriptTooLarge: "transcript_too_large",
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
	const session = await getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({
			message: "Session is being deleted",
		});
	}

	const segments = await ctx.db
		.query("segments")
		.withIndex("by_session_id_and_sequence", (q) =>
			q.eq("sessionId", sessionId),
		)
		.order("asc")
		.take(MAX_TRANSCRIPT_SEGMENTS + 1);
	if (segments.length > MAX_TRANSCRIPT_SEGMENTS) {
		throw new TranscriptTooLarge({
			message: "Transcript is too large to download",
		});
	}

	const transcript = segments.map((segment) => segment.sourceText).join("\n");
	if (transcript.length > MAX_TRANSCRIPT_CHARS) {
		throw new TranscriptTooLarge({
			message: "Transcript is too large to download",
		});
	}

	return transcript;
}

const toPublicSegment = (segment: Doc<"segments">) => ({
	_id: segment._id,
	_creationTime: segment._creationTime,
	sessionId: segment.sessionId,
	sourceText: segment.sourceText,
	sourceLanguage: segment.sourceLanguage,
	status: segment.status,
	translations: segment.translations,
	...(segment.error !== undefined ? { error: segment.error } : {}),
});

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
	handler: async (ctx, args) =>
		atPublicEdge(() => readTranscriptText(ctx, args.sessionId)),
});

export { segmentValidator };
