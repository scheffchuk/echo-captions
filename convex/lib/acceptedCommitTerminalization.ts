import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { finishCommitDrain } from "./broadcasts";

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

export function assertTargetCompletion(
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

	if (decrementPendingCount) {
		await finishCommitDrain(ctx, commit.broadcastId);
	}
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

	await publishAcceptedCommit(ctx, commit, targets, true);
}
