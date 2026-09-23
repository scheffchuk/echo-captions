import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { CAPTION_TARGET_RETRY_BEHAVIOR } from "./captionRetry";

const RETRY_PRIORITY_POLL_DELAY_MS = 500;

const captionWorkpool = new Workpool(components.captionWorkpool, {
	maxParallelism: 4,
});

export async function enqueueCaptionTargets(
	ctx: MutationCtx,
	acceptedCommitId: Id<"acceptedCommits">,
	targetIds: readonly Id<"acceptedCommitTargets">[],
	runAfterMillis?: number,
) {
	if (targetIds.length === 0) return;

	const workIds = await captionWorkpool.enqueueActionBatch(
		ctx,
		internal.captions.translateTarget,
		targetIds.map((targetId) => ({ targetId })),
		{
			onComplete: internal.captions.targetCompleted,
			context: { acceptedCommitId },
			retry: CAPTION_TARGET_RETRY_BEHAVIOR,
			...(runAfterMillis === undefined
				? { runAt: Date.now() }
				: { runAfter: runAfterMillis }),
		},
	);

	for (const [index, targetId] of targetIds.entries()) {
		const workId = workIds[index];

		if (workId) {
			await ctx.db.patch(targetId, { workId });
		}
	}
}

export async function scheduleRetryDispatch(
	ctx: MutationCtx,
	delayMillis = RETRY_PRIORITY_POLL_DELAY_MS,
) {
	await ctx.scheduler.runAfter(
		delayMillis,
		internal.captions.resumeDeferredRetries,
		{},
	);
}
