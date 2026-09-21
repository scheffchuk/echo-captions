import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { finishCommitDrain } from "./broadcasts";
import { CAPTION_TARGET_RETRY_BEHAVIOR } from "./captionRetry";
import {
	enqueueCaptionTargets,
	scheduleRetryDispatch,
} from "./captionWorkpool";

export const MAX_PROVIDER_ATTEMPTS = CAPTION_TARGET_RETRY_BEHAVIOR.maxAttempts;

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
	  }
	| {
			kind: "deferred";
			targetId: Id<"acceptedCommitTargets">;
			targetLanguage: string;
			retryAfterMillis?: number;
	  };

export type TargetCompletionPolicyInput = Pick<
	Doc<"acceptedCommitTargets">,
	"_id" | "targetLanguage" | "priority" | "providerAttemptCount"
>;

export type TargetCompletionDecision =
	| {
			kind: "terminal";
			status: "translated";
			translation: string;
	  }
	| {
			kind: "terminal";
			status: "failed";
			error: string;
	  }
	| {
			kind: "retry";
			providerAttemptCount: number;
			retryAfterMillis: number;
	  }
	| { kind: "defer" };

export function classifyTargetCompletion(
	target: TargetCompletionPolicyInput,
	completion: TargetCompletion,
): TargetCompletionDecision {
	if (
		completion.targetId !== target._id ||
		completion.targetLanguage !== target.targetLanguage
	) {
		throw new Error("Translation completion identity mismatch");
	}

	if (completion.kind === "translated") {
		if (!completion.translation.trim()) {
			throw new Error("Translated completion has no translation");
		}
		return {
			kind: "terminal",
			status: "translated",
			translation: completion.translation,
		};
	}

	if (completion.kind === "failed") {
		if (!completion.error.trim()) {
			throw new Error("Failed completion has no error classification");
		}
		return { kind: "terminal", status: "failed", error: completion.error };
	}

	if (completion.retryAfterMillis !== undefined) {
		if (
			!Number.isFinite(completion.retryAfterMillis) ||
			completion.retryAfterMillis <= 0
		) {
			throw new Error("Deferred completion has an invalid retry delay");
		}
		const providerAttemptCount = (target.providerAttemptCount ?? 0) + 1;
		if (providerAttemptCount < MAX_PROVIDER_ATTEMPTS) {
			return {
				kind: "retry",
				providerAttemptCount,
				retryAfterMillis: completion.retryAfterMillis,
			};
		}
		return {
			kind: "terminal",
			status: "failed",
			error: "Translation retries exhausted",
		};
	}

	if (target.priority !== "retry") {
		throw new Error("Live translation target cannot be deferred");
	}
	return { kind: "defer" };
}

type AcceptedCommit = Doc<"acceptedCommits">;
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
	const segmentId =
		existing?._id ??
		(await ctx.db.insert("segments", {
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
			...(status === "failed" && error ? { error } : {}),
		}));

	if (existing) {
		await ctx.db.patch(existing._id, {
			status,
			translations,
			error: status === "failed" ? error : undefined,
		});
	}

	return segmentId;
}

async function finishAcceptedCommit(
	ctx: MutationCtx,
	commit: AcceptedCommit,
	decrementPendingCount: boolean,
) {
	if (decrementPendingCount) {
		await finishCommitDrain(ctx, commit.broadcastId);
	}
	await scheduleRetryDispatch(ctx, 0);
}

async function publishAcceptedCommit(
	ctx: MutationCtx,
	commit: AcceptedCommit,
	targets: readonly AcceptedCommitTarget[],
	decrementPendingCount: boolean,
) {
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
		failed ? {} : translations,
		error,
	);
	await ctx.db.patch(commit._id, {
		status,
		completedTargetCount: translatedTargets.length,
		failedTargetCount: failedTargets.length,
		segmentId,
		error,
	});

	await finishAcceptedCommit(ctx, commit, decrementPendingCount);
}

async function getTargetByWorkId(ctx: MutationCtx, workId: string) {
	return await ctx.db
		.query("acceptedCommitTargets")
		.withIndex("by_work_id", (q) => q.eq("workId", workId))
		.unique();
}

export async function completeAcceptedCommit(
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
		await publishAcceptedCommit(ctx, commit, [], false);
		return;
	}

	const target = await getTargetByWorkId(ctx, input.workId);
	if (!target) return;
	if (target.acceptedCommitId !== input.acceptedCommitId) {
		throw new Error("Translation completion commit identity mismatch");
	}
	const commit = await ctx.db.get("acceptedCommits", input.acceptedCommitId);
	if (!commit) {
		throw new Error("Translation target references a missing Accepted commit");
	}
	if (commit.status !== "pending" || target.status !== "pending") return;

	const decision = classifyTargetCompletion(target, input.completion);
	if (decision.kind === "retry") {
		await ctx.db.patch(target._id, {
			providerAttemptCount: decision.providerAttemptCount,
		});
		await enqueueCaptionTargets(
			ctx,
			commit._id,
			[target._id],
			decision.retryAfterMillis,
		);
		return;
	}
	if (decision.kind === "defer") {
		await ctx.db.patch(target._id, { workId: undefined });
		await scheduleRetryDispatch(ctx);
		return;
	}

	await ctx.db.patch(target._id, {
		status: decision.status,
		translation:
			decision.status === "translated" ? decision.translation : undefined,
		error: decision.status === "failed" ? decision.error : undefined,
		workId: undefined,
		providerAttemptCount: undefined,
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
	await ctx.db.patch(commit._id, {
		completedTargetCount,
		failedTargetCount,
	});
	if (targets.some((item) => item.status === "pending")) return;

	const refreshed = await ctx.db.get("acceptedCommits", commit._id);
	if (refreshed?.status !== "pending") return;
	await publishAcceptedCommit(ctx, refreshed, targets, true);
}
