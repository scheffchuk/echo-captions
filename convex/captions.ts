import { type RunResult, vOnCompleteArgs } from "@convex-dev/workpool";
import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { Effect, Layer, ManagedRuntime } from "effect";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { convexConfigLayer } from "./effect/config";
import {
	completeAcceptedCommit,
	type TargetCompletion,
} from "./lib/acceptedCommitTerminalization";
import { getCurrentOperatorId } from "./lib/auth";
import { enqueueCaptionTargets } from "./lib/captionWorkpool";
import { GoogleTranslate } from "./lib/googleTranslate";
import {
	computeTranslationTargets,
	resolveSourceLanguage,
} from "./lib/languages";
import { translationDocuments } from "./lib/translationMappings";
import {
	acceptedCommitStatusValidator,
	acceptedCommitTargetStatusValidator,
	translationMappingValidator,
} from "./schema";

const MAX_COMMIT_ID_CHARS = 128;

const MAX_SOURCE_TEXT_CHARS = 8_000;

const acceptedCommitReceiptValidator = v.object({
	acceptedCommitId: v.id("acceptedCommits"),
	commitId: v.string(),
	status: acceptedCommitStatusValidator,
	sequence: v.number(),
	targetCount: v.number(),
	completedTargetCount: v.number(),
	failedTargetCount: v.number(),
	segmentId: v.union(v.id("segments"), v.null()),
});

const operatorCommitValidator = v.object({
	acceptedCommitId: v.id("acceptedCommits"),
	commitId: v.string(),
	sessionId: v.id("sessions"),
	broadcastId: v.id("broadcasts"),
	broadcastSequence: v.number(),
	commitOrdinal: v.number(),
	sequence: v.number(),
	sourceText: v.string(),
	sourceLanguage: v.string(),
	translationTargets: v.array(v.string()),
	status: acceptedCommitStatusValidator,
	targetCount: v.number(),
	completedTargetCount: v.number(),
	failedTargetCount: v.number(),
	translations: v.record(v.string(), v.string()),
	segmentId: v.union(v.id("segments"), v.null()),
	error: v.optional(v.string()),
});

const targetTranslationResultValidator = v.union(
	v.object({
		kind: v.literal("translated"),
		targetId: v.id("acceptedCommitTargets"),
		targetLanguage: v.string(),
		translation: v.string(),
	}),
	v.object({
		kind: v.literal("failed"),
		targetId: v.id("acceptedCommitTargets"),
		targetLanguage: v.string(),
		error: v.string(),
	}),
);

const targetContextValidator = v.union(
	v.object({
		targetId: v.id("acceptedCommitTargets"),
		targetLanguage: v.string(),
		sourceText: v.string(),
		sourceLanguage: v.string(),
		status: acceptedCommitTargetStatusValidator,
		mappings: v.union(v.array(translationMappingValidator), v.null()),
	}),
	v.null(),
);

type AcceptedCommit = Doc<"acceptedCommits">;

const runtime = ManagedRuntime.make(
	GoogleTranslate.layer.pipe(Layer.provide(convexConfigLayer)),
);

function throwCaptionError(code: string, message: string): never {
	throw new ConvexError({ code, message });
}

function validateCommitInput(args: {
	commitId: string;
	sourceText: string;
	commitOrdinal: number;
}) {
	const commitId = args.commitId.trim();

	if (
		commitId.length === 0 ||
		Array.from(commitId).length > MAX_COMMIT_ID_CHARS
	) {
		throwCaptionError(
			"invalid_commit_id",
			"Commit ID must be between 1 and 128 characters",
		);
	}

	const sourceText = args.sourceText.trim();

	if (sourceText.length === 0) {
		throwCaptionError("invalid_transcript", "Empty transcript");
	}

	if (Array.from(sourceText).length > MAX_SOURCE_TEXT_CHARS) {
		throwCaptionError("invalid_transcript", "Transcript too long");
	}

	if (!Number.isSafeInteger(args.commitOrdinal) || args.commitOrdinal <= 0) {
		throwCaptionError(
			"invalid_commit_ordinal",
			"Commit ordinal must be a positive integer",
		);
	}

	return { commitId, sourceText };
}

async function getOperatorSession(
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"sessions">,
) {
	const operatorId = await getCurrentOperatorId(ctx);

	if (!operatorId) {
		throwCaptionError("not_authenticated", "Not authenticated");
	}

	const session = await ctx.db.get("sessions", sessionId);

	if (!session) {
		throwCaptionError("session_not_found", "Session not found");
	}

	if (session.ownerId !== operatorId) {
		throwCaptionError("unauthorized", "Unauthorized");
	}

	return session;
}

function toReceipt(commit: AcceptedCommit) {
	return {
		acceptedCommitId: commit._id,
		commitId: commit.commitId,
		status: commit.status,
		sequence: commit.sequence,
		targetCount: commit.targetCount,
		completedTargetCount: commit.completedTargetCount,
		failedTargetCount: commit.failedTargetCount,
		segmentId: commit.segmentId ?? null,
	};
}

async function getAcceptedCommitById(
	ctx: QueryCtx | MutationCtx,
	acceptedCommitId: Id<"acceptedCommits">,
) {
	return await ctx.db.get("acceptedCommits", acceptedCommitId);
}

async function acceptCommitInTransaction(
	ctx: MutationCtx,
	args: {
		sessionId: Id<"sessions">;
		broadcastId: Id<"broadcasts">;
		commitOrdinal: number;
		commitId: string;
		sourceText: string;
		sourceLanguage: string;
	},
) {
	const session = await getOperatorSession(ctx, args.sessionId);

	if (session.deletionRequestedAt !== undefined) {
		throwCaptionError("session_deleting", "Session is being deleted");
	}

	const { commitId, sourceText } = validateCommitInput(args);

	const sourceLanguage = resolveSourceLanguage(
		args.sourceLanguage.trim() || undefined,
		session.spokenLanguages,
	);

	const existingAccepted = await ctx.db
		.query("acceptedCommits")
		.withIndex("by_commit_id", (q) => q.eq("commitId", commitId))
		.first();

	if (existingAccepted) {
		if (
			existingAccepted.sessionId !== args.sessionId ||
			existingAccepted.broadcastId !== args.broadcastId ||
			existingAccepted.commitOrdinal !== args.commitOrdinal ||
			existingAccepted.sourceText !== sourceText ||
			existingAccepted.sourceLanguage !== sourceLanguage
		) {
			throwCaptionError(
				"commit_conflict",
				"Commit ID is already used for a different snapshot",
			);
		}

		return toReceipt(existingAccepted);
	}

	const broadcast = await ctx.db.get("broadcasts", args.broadcastId);

	if (!broadcast || broadcast.sessionId !== args.sessionId) {
		throwCaptionError("broadcast_not_found", "Broadcast not found");
	}

	if (broadcast.status !== "active") {
		throwCaptionError("broadcast_not_active", "Broadcast is no longer active");
	}

	if (args.commitOrdinal !== broadcast.lastCommitOrdinal + 1) {
		throwCaptionError(
			"broadcast_conflict",
			"Commit ordinal is not the next position",
		);
	}

	const mappingRevisionId = session.translationMappingRevisionId;

	if (mappingRevisionId) {
		const revision = await ctx.db.get(
			"translationMappingRevisions",
			mappingRevisionId,
		);

		if (!revision || revision.sessionId !== session._id) {
			throwCaptionError(
				"mapping_validation_error",
				"The Session mapping revision is unavailable",
			);
		}
	}

	const translationTargets = computeTranslationTargets(
		session.audienceLanguages,
		sourceLanguage,
	);

	const sequence = session.lastCommitSequence + 1;

	const acceptedCommit = {
		sessionId: args.sessionId,
		broadcastId: args.broadcastId,
		broadcastSequence: broadcast.sequence,
		commitOrdinal: args.commitOrdinal,
		commitId,
		sequence,
		sourceText,
		sourceLanguage,
		translationTargets,
		targetCount: translationTargets.length,
		completedTargetCount: 0,
		failedTargetCount: 0,
		status: "pending" as const,
	};

	const acceptedCommitId = await ctx.db.insert(
		"acceptedCommits",
		mappingRevisionId
			? { ...acceptedCommit, translationMappingRevisionId: mappingRevisionId }
			: acceptedCommit,
	);

	const targetIds: Id<"acceptedCommitTargets">[] = [];

	for (const targetLanguage of translationTargets) {
		targetIds.push(
			await ctx.db.insert("acceptedCommitTargets", {
				acceptedCommitId,
				sessionId: args.sessionId,
				targetLanguage,
				status: "pending",
			}),
		);
	}

	const lastActivityAt = Date.now();
	await ctx.db.patch(args.sessionId, {
		lastCommitSequence: sequence,
		lastActivityAt,
	});
	await ctx.db.patch(args.broadcastId, {
		lastCommitOrdinal: args.commitOrdinal,
		pendingCommitCount:
			broadcast.pendingCommitCount + (targetIds.length > 0 ? 1 : 0),
	});

	const accepted = await getAcceptedCommitById(ctx, acceptedCommitId);

	if (!accepted)
		throw new Error("Accepted commit disappeared during acceptance");

	if (targetIds.length === 0) {
		await completeAcceptedCommit(ctx, { acceptedCommitId, completion: null });
		const finished = await getAcceptedCommitById(ctx, acceptedCommitId);

		if (!finished)
			throw new Error("Accepted commit disappeared after publication");

		return toReceipt(finished);
	}

	await enqueueCaptionTargets(ctx, "live", acceptedCommitId, targetIds);

	return toReceipt(accepted);
}

export const acceptCommit = mutation({
	args: {
		sessionId: v.id("sessions"),
		broadcastId: v.id("broadcasts"),
		commitOrdinal: v.number(),
		commitId: v.string(),
		sourceText: v.string(),
		sourceLanguage: v.string(),
	},
	returns: acceptedCommitReceiptValidator,
	handler: (ctx, args) => acceptCommitInTransaction(ctx, args),
});

export const retryCommit = mutation({
	args: { acceptedCommitId: v.id("acceptedCommits") },
	returns: acceptedCommitReceiptValidator,
	handler: async (ctx, args) => {
		const accepted = await getAcceptedCommitById(ctx, args.acceptedCommitId);

		if (!accepted) {
			throwCaptionError("commit_not_found", "Accepted commit not found");
		}

		const session = await getOperatorSession(ctx, accepted.sessionId);

		if (session.deletionRequestedAt !== undefined) {
			throwCaptionError("session_deleting", "Session is being deleted");
		}

		if (accepted.status === "pending") return toReceipt(accepted);

		if (accepted.status !== "failed") return toReceipt(accepted);
		const broadcast = await ctx.db.get("broadcasts", accepted.broadcastId);

		if (!broadcast || broadcast.sessionId !== session._id) {
			throwCaptionError("broadcast_not_found", "Broadcast not found");
		}

		if (broadcast.status !== "active") {
			throwCaptionError(
				"broadcast_not_active",
				"Broadcast is no longer active",
			);
		}

		const targets = await ctx.db
			.query("acceptedCommitTargets")
			.withIndex("by_accepted_commit_id_and_status", (q) =>
				q.eq("acceptedCommitId", accepted._id),
			)
			.take(accepted.targetCount + 1);

		if (targets.length !== accepted.targetCount || targets.length === 0) {
			throwCaptionError(
				"commit_conflict",
				"Accepted commit targets are unavailable",
			);
		}

		const failedTargets = targets.filter(
			(target) => target.status === "failed",
		);

		await Promise.all(
			failedTargets.map((target) =>
				ctx.db.patch(target._id, { status: "pending", error: undefined }),
			),
		);
		await ctx.db.patch(accepted._id, {
			status: "pending",
			failedTargetCount: 0,
			error: undefined,
		});
		await ctx.db.patch(broadcast._id, {
			pendingCommitCount: broadcast.pendingCommitCount + 1,
		});
		await enqueueCaptionTargets(
			ctx,
			"retry",
			accepted._id,
			failedTargets.map((target) => target._id),
		);

		const retried = await getAcceptedCommitById(ctx, accepted._id);

		if (!retried) throw new Error("Accepted commit disappeared during retry");

		return toReceipt(retried);
	},
});

async function toOperatorCommit(ctx: QueryCtx, commit: AcceptedCommit) {
	const segment = commit.segmentId
		? await ctx.db.get("segments", commit.segmentId)
		: null;

	const operatorCommit = {
		acceptedCommitId: commit._id,
		commitId: commit.commitId,
		sessionId: commit.sessionId,
		broadcastId: commit.broadcastId,
		broadcastSequence: commit.broadcastSequence,
		commitOrdinal: commit.commitOrdinal,
		sequence: commit.sequence,
		sourceText: commit.sourceText,
		sourceLanguage: commit.sourceLanguage,
		translationTargets: commit.translationTargets,
		status: commit.status,
		targetCount: commit.targetCount,
		completedTargetCount: commit.completedTargetCount,
		failedTargetCount: commit.failedTargetCount,
		translations: segment?.translations ?? {},
		segmentId: commit.segmentId ?? null,
	};

	const error = commit.error ?? segment?.error;

	if (!error) return operatorCommit;

	return { ...operatorCommit, error };
}

export const listOperatorCommits = query({
	args: {
		sessionId: v.id("sessions"),
		paginationOpts: paginationOptsValidator,
	},
	returns: paginationResultValidator(operatorCommitValidator),
	handler: async (ctx, args) => {
		const session = await getOperatorSession(ctx, args.sessionId);

		const page = await ctx.db
			.query("acceptedCommits")
			.withIndex("by_session_id_and_sequence", (q) =>
				q.eq("sessionId", session._id),
			)
			.order("desc")
			.paginate(args.paginationOpts);

		return {
			...page,
			page: await Promise.all(
				page.page.map((commit) => toOperatorCommit(ctx, commit)),
			),
		};
	},
});

export const getTargetForAction = internalQuery({
	args: { targetId: v.id("acceptedCommitTargets") },
	returns: targetContextValidator,
	handler: async (ctx, args) => {
		const target = await ctx.db.get("acceptedCommitTargets", args.targetId);

		if (!target) return null;
		const commit = await ctx.db.get("acceptedCommits", target.acceptedCommitId);

		if (!commit || target.sessionId !== commit.sessionId) return null;

		const revision = commit.translationMappingRevisionId
			? await ctx.db.get(
					"translationMappingRevisions",
					commit.translationMappingRevisionId,
				)
			: null;

		return {
			targetId: target._id,
			targetLanguage: target.targetLanguage,
			sourceText: commit.sourceText,
			sourceLanguage: commit.sourceLanguage,
			status: target.status,
			mappings: commit.translationMappingRevisionId
				? (revision?.mappings ?? null)
				: [],
		};
	},
});

export const translateTarget = internalAction({
	args: { targetId: v.id("acceptedCommitTargets") },
	returns: targetTranslationResultValidator,
	handler: async (ctx, args): Promise<TargetCompletion> => {
		const target = await ctx.runQuery(
			internal.captions.getTargetForAction,
			args,
		);

		if (!target) {
			return {
				kind: "failed",
				targetId: args.targetId,
				targetLanguage: "unknown",
				error: "Translation target is unavailable",
			};
		}

		const fail = (error: string): TargetCompletion => ({
			kind: "failed",
			targetId: target.targetId,
			targetLanguage: target.targetLanguage,
			error,
		});

		if (target.status !== "pending") {
			return fail("Translation target is no longer pending");
		}

		if (!target.mappings) {
			return fail("Translation mapping revision is unavailable");
		}

		const [document] = translationDocuments(
			target.sourceText,
			target.mappings,
			[target.targetLanguage],
		);

		if (!document) return fail("Translation document is unavailable");

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* google.translateOne(document, target.sourceLanguage);
		}).pipe(
			Effect.map(
				(translation): TargetCompletion => ({
					kind: "translated",
					targetId: target.targetId,
					targetLanguage: target.targetLanguage,
					translation,
				}),
			),
			Effect.catch((error) => Effect.succeed(fail(error.message))),
		);

		return runtime.runPromise(program);
	},
});

async function mapTargetCompletion(
	ctx: MutationCtx,
	args: {
		workId: string;
		context: { acceptedCommitId: Id<"acceptedCommits"> };
		result: RunResult<TargetCompletion>;
	},
): Promise<TargetCompletion | null> {
	if (args.result.kind === "success") return args.result.returnValue;

	const target = await ctx.db
		.query("acceptedCommitTargets")
		.withIndex("by_work_id", (q) => q.eq("workId", args.workId))
		.unique();

	if (!target) return null;

	if (target.acceptedCommitId !== args.context.acceptedCommitId) {
		throw new Error("Translation completion commit identity mismatch");
	}

	return {
		kind: "failed",
		targetId: target._id,
		targetLanguage: target.targetLanguage,
		error:
			args.result.kind === "failed"
				? "Translation failed unexpectedly"
				: "Translation canceled",
	};
}

export const targetCompleted = internalMutation({
	args: vOnCompleteArgs(
		v.object({ acceptedCommitId: v.id("acceptedCommits") }),
		targetTranslationResultValidator,
	),
	returns: v.null(),
	handler: async (ctx, args) => {
		const completion = await mapTargetCompletion(ctx, args);

		if (completion) {
			await completeAcceptedCommit(ctx, {
				workId: args.workId,
				acceptedCommitId: args.context.acceptedCommitId,
				completion,
			});
		}

		return null;
	},
});

export {
	acceptedCommitReceiptValidator,
	operatorCommitValidator,
	targetTranslationResultValidator,
};
