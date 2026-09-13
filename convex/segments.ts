import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { Effect, Schema } from "effect";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { exhaustPublicErrors, fromConvex } from "./effect/convex";
import { runConvex } from "./effect/run";
import { authErrorCodes, getOperator } from "./lib/auth";
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

const readTranscriptText = Effect.fn("Segments.transcriptText")(function* (
	ctx: QueryCtx,
	sessionId: Id<"sessions">,
) {
	const ownerId = yield* getOperator(ctx);
	const session = yield* getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({
			message: "Session is being deleted",
		});
	}

	const segments = yield* fromConvex(
		() =>
			ctx.db
				.query("segments")
				.withIndex("by_session_id_and_sequence", (q) =>
					q.eq("sessionId", sessionId),
				)
				.order("asc")
				.take(MAX_TRANSCRIPT_SEGMENTS + 1),
		"Segments.transcriptText.list",
	);
	if (segments.length > MAX_TRANSCRIPT_SEGMENTS) {
		return yield* new TranscriptTooLarge({
			message: "Transcript is too large to download",
		});
	}

	const transcript = segments.map((segment) => segment.sourceText).join("\n");
	if (transcript.length > MAX_TRANSCRIPT_CHARS) {
		return yield* new TranscriptTooLarge({
			message: "Transcript is too large to download",
		});
	}

	return transcript;
});

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
	handler: (ctx, args) =>
		runConvex(
			Effect.gen(function* () {
				const session = yield* fromConvex(
					() => ctx.db.get("sessions", args.sessionId),
					"Segments.listBySession.getSession",
				);
				if (!session || session.deletionRequestedAt !== undefined) {
					return {
						page: [],
						isDone: true,
						continueCursor: "",
						pageStatus: null,
						splitCursor: null,
					};
				}

				const page = yield* fromConvex(
					() =>
						ctx.db
							.query("segments")
							.withIndex("by_session_id_and_sequence", (q) =>
								q.eq("sessionId", args.sessionId),
							)
							.order("desc")
							.paginate(args.paginationOpts),
					"Segments.listBySession.paginate",
				);
				return { ...page, page: page.page.map(toPublicSegment) };
			}).pipe(Effect.orDie),
		),
});

export const transcriptText = query({
	args: { sessionId: v.id("sessions") },
	returns: v.string(),
	handler: (ctx, args) =>
		runConvex(
			readTranscriptText(ctx, args.sessionId).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export { segmentValidator };
