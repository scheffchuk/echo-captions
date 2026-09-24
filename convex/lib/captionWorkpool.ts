import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Separate pools keep explicit retries from occupying live-caption slots.
const pools = {
	live: new Workpool(components.captionWorkpool, { maxParallelism: 10 }),
	retry: new Workpool(components.captionRetryWorkpool, { maxParallelism: 2 }),
};

export async function enqueueCaptionTargets(
	ctx: MutationCtx,
	pool: keyof typeof pools,
	acceptedCommitId: Id<"acceptedCommits">,
	targetIds: readonly Id<"acceptedCommitTargets">[],
) {
	const workIds = await pools[pool].enqueueActionBatch(
		ctx,
		internal.captions.translateTarget,
		targetIds.map((targetId) => ({ targetId })),
		{
			onComplete: internal.captions.targetCompleted,
			context: { acceptedCommitId },
		},
	);

	for (const [index, targetId] of targetIds.entries()) {
		const workId = workIds[index];

		if (workId) {
			await ctx.db.patch(targetId, { workId });
		}
	}
}
