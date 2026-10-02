import type { RunResult } from "@convex-dev/workpool";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentOperatorId } from "./auth";
import {
	admitBroadcastCommit,
	assertValidBroadcastState,
	finishCommitDrain,
} from "./broadcasts";
import { enqueueCaptionTargets } from "./captionWorkpool";
import { computeTranslationTargets, resolveSourceLanguage } from "./languages";

const MAX_COMMIT_ID_CHARS = 128;

const MAX_SOURCE_TEXT_CHARS = 8_000;

type AcceptedCommit = Doc<"acceptedCommits">;

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

export async function getOperatorSession(
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

export async function acceptBroadcastCommit(
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

	const translationTargets = computeTranslationTargets(
		session.audienceLanguages,
		sourceLanguage,
	);

	const broadcast = await admitBroadcastCommit(ctx, {
		sessionId: args.sessionId,
		broadcastId: args.broadcastId,
		commitOrdinal: args.commitOrdinal,
		targetCount: translationTargets.length,
	});

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

export async function retryBroadcastCommit(
	ctx: MutationCtx,
	args: { acceptedCommitId: Id<"acceptedCommits"> },
) {
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

	const segment = accepted.segmentId
		? await ctx.db.get("segments", accepted.segmentId)
		: null;

	if (!segment) throw new Error("Accepted commit references a missing Segment");

	if (segment.acceptedCommitId !== accepted._id)
		throw new Error("Accepted commit references the wrong Segment");
	const broadcast = await ctx.db.get("broadcasts", accepted.broadcastId);

	if (!broadcast || broadcast.sessionId !== session._id) {
		throw new Error("Accepted commit references a missing or wrong Broadcast");
	}

	assertValidBroadcastState(broadcast);

	const targets = await ctx.db
		.query("acceptedCommitTargets")
		.withIndex("by_accepted_commit_id_and_status", (q) =>
			q.eq("acceptedCommitId", accepted._id),
		)
		.take(accepted.targetCount + 1);

	if (targets.length !== accepted.targetCount || targets.length === 0) {
		throw new Error("Accepted commit targets are unavailable");
	}

	const failedTargets = targets.filter((target) => target.status === "failed");

	if (
		failedTargets.length === 0 ||
		targets.some((target) => target.status === "pending")
	) {
		throw new Error("Failed Accepted commit has inconsistent target state");
	}

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
	await enqueueCaptionTargets(
		ctx,
		"retry",
		accepted._id,
		failedTargets.map((target) => target._id),
	);

	const retried = await getAcceptedCommitById(ctx, accepted._id);

	if (!retried) throw new Error("Accepted commit disappeared during retry");

	return toReceipt(retried);
}

export type TargetCompletion =
	| {
			kind: "translated";
			targetId: Id<"acceptedCommitTargets">;
			targetLanguage: string;
			translation: string;
	  }
	| {
			kind: "failed";
			targetId: Id<"acceptedCommitTargets">;
			targetLanguage: string;
			error: string;
	  };

function assertTargetCompletion(
	target: Pick<Doc<"acceptedCommitTargets">, "_id" | "targetLanguage">,
	completion: TargetCompletion,
) {
	if (
		completion.targetId !== target._id ||
		completion.targetLanguage !== target.targetLanguage
	) {
		throw new Error("Translation completion identity mismatch");
	}

	if (completion.kind === "translated" && !completion.translation.trim()) {
		throw new Error("Translated completion has no translation");
	}

	if (completion.kind === "failed" && !completion.error.trim()) {
		throw new Error("Failed completion has no error classification");
	}
}

type AcceptedCommitTarget = Doc<"acceptedCommitTargets">;

type CompleteAcceptedCommitInput =
	| {
			acceptedCommitId: Id<"acceptedCommits">;
			workId: string;
			completion: TargetCompletion;
	  }
	| {
			acceptedCommitId: Id<"acceptedCommits">;
			completion: null;
	  };

async function createFinishedSegment(
	ctx: MutationCtx,
	commit: AcceptedCommit,
	status: "translated" | "failed",
	translations: Record<string, string>,
	error: string | undefined,
) {
	const existing = commit.segmentId
		? await ctx.db.get("segments", commit.segmentId)
		: null;

	if (commit.segmentId && !existing) {
		throw new Error("Accepted commit references a missing Segment");
	}

	if (existing && existing.acceptedCommitId !== commit._id) {
		throw new Error("Accepted commit references the wrong Segment");
	}

	if (existing) {
		await ctx.db.patch(existing._id, {
			status,
			translations,
			error: status === "failed" ? error : undefined,
		});

		return existing._id;
	}

	const segmentFields = {
		sessionId: commit.sessionId,
		broadcastId: commit.broadcastId,
		broadcastSequence: commit.broadcastSequence,
		commitOrdinal: commit.commitOrdinal,
		commitId: commit.commitId,
		sequence: commit.sequence,
		sourceText: commit.sourceText,
		sourceLanguage: commit.sourceLanguage,
		status,
		translations,
		acceptedCommitId: commit._id,
	};

	return await ctx.db.insert(
		"segments",
		status === "failed" && error ? { ...segmentFields, error } : segmentFields,
	);
}

async function publishAcceptedCommit(
	ctx: MutationCtx,
	commit: AcceptedCommit,
	targets: readonly AcceptedCommitTarget[],
) {
	const broadcast = await ctx.db.get("broadcasts", commit.broadcastId);

	if (!broadcast || broadcast.sessionId !== commit.sessionId) {
		throw new Error("Accepted commit references a missing or wrong Broadcast");
	}

	assertValidBroadcastState(broadcast);

	const failedTargets = targets.filter((target) => target.status === "failed");

	const translatedTargets = targets.filter(
		(target) => target.status === "translated",
	);

	if (
		targets.length !== commit.targetCount ||
		translatedTargets.length + failedTargets.length !== commit.targetCount
	) {
		throw new Error("Accepted commit target state is incomplete");
	}

	const failed = failedTargets.length > 0;
	const translations: Record<string, string> = {};

	if (!failed) {
		for (const target of translatedTargets) {
			if (!target.translation?.trim()) {
				throw new Error("Translated target has no translation");
			}

			translations[target.targetLanguage] = target.translation;
		}
	}

	const status = failed ? ("failed" as const) : ("translated" as const);
	const error = failed ? "Translation failed" : undefined;

	const segmentId = await createFinishedSegment(
		ctx,
		commit,
		status,
		translations,
		error,
	);

	await ctx.db.patch(commit._id, {
		status,
		completedTargetCount: translatedTargets.length,
		failedTargetCount: failedTargets.length,
		segmentId,
		error,
	});

	if (!commit.segmentId && commit.targetCount > 0) {
		await finishCommitDrain(ctx, commit.broadcastId);
	}
}

async function completeAcceptedCommit(
	ctx: MutationCtx,
	input: CompleteAcceptedCommitInput,
) {
	if (input.completion === null) {
		const commit = await ctx.db.get("acceptedCommits", input.acceptedCommitId);

		if (!commit) return;

		if (commit.status !== "pending") return;

		if (commit.targetCount !== 0) {
			throw new Error("Accepted commit has unexpected zero-target completion");
		}

		await publishAcceptedCommit(ctx, commit, []);

		return;
	}

	const target = await ctx.db
		.query("acceptedCommitTargets")
		.withIndex("by_work_id", (q) => q.eq("workId", input.workId))
		.unique();

	if (!target) return;

	if (target.acceptedCommitId !== input.acceptedCommitId) {
		throw new Error("Translation completion commit identity mismatch");
	}

	const commit = await ctx.db.get("acceptedCommits", input.acceptedCommitId);

	if (!commit) {
		throw new Error("Translation target references a missing Accepted commit");
	}

	if (commit.status !== "pending" || target.status !== "pending") return;

	const { completion } = input;
	assertTargetCompletion(target, completion);

	await ctx.db.patch(target._id, {
		status: completion.kind,
		translation:
			completion.kind === "translated" ? completion.translation : undefined,
		error: completion.kind === "failed" ? completion.error : undefined,
		workId: undefined,
	});

	const targets = await ctx.db
		.query("acceptedCommitTargets")
		.withIndex("by_accepted_commit_id_and_status", (q) =>
			q.eq("acceptedCommitId", commit._id),
		)
		.take(commit.targetCount + 1);

	if (targets.length !== commit.targetCount) {
		throw new Error("Accepted commit target count mismatch");
	}

	const completedTargetCount = targets.filter(
		(item) => item.status === "translated",
	).length;

	const failedTargetCount = targets.filter(
		(item) => item.status === "failed",
	).length;

	if (completedTargetCount + failedTargetCount < commit.targetCount) {
		await ctx.db.patch(commit._id, { completedTargetCount, failedTargetCount });

		return;
	}

	await publishAcceptedCommit(ctx, commit, targets);
}

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

export async function completeBroadcastCommit(
	ctx: MutationCtx,
	event: {
		workId: string;
		context: { acceptedCommitId: Id<"acceptedCommits"> };
		result: RunResult<TargetCompletion>;
	},
) {
	const completion = await mapTargetCompletion(ctx, event);

	if (completion)
		await completeAcceptedCommit(ctx, {
			workId: event.workId,
			acceptedCommitId: event.context.acceptedCommitId,
			completion,
		});

	return null;
}
