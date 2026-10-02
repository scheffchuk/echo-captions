import { query } from "convex:/_system/repl/wrappers.js";

// Read-only, bounded audit. A partial result must never authorize rollout.
export default query({
	handler: async (ctx) => {
		const commits = await ctx.db.query("acceptedCommits").take(501);
		const broadcasts = await ctx.db.query("broadcasts").take(501);
		const complete = commits.length <= 500 && broadcasts.length <= 500;
		const obligations = new Map();

		for (const commit of commits) {
			// Old repairs also count before the pause has drained them.
			if (commit.status === "pending" && commit.targetCount > 0) {
				obligations.set(
					commit.broadcastId,
					(obligations.get(commit.broadcastId) ?? 0) + 1,
				);
			}
		}

		return {
			complete,
			countMismatches: complete
				? broadcasts.filter(
						(broadcast) =>
							broadcast.pendingCommitCount !==
							(obligations.get(broadcast._id) ?? 0),
					).length
				: null,
			pendingInitial: commits.filter(
				(commit) => commit.status === "pending" && !commit.segmentId,
			).length,
			pendingRetries: commits.filter(
				(commit) => commit.status === "pending" && commit.segmentId,
			).length,
			invalidCountStates: broadcasts.filter(
				(broadcast) =>
					broadcast.pendingCommitCount < 0 ||
					(broadcast.status === "sealed" && broadcast.pendingCommitCount !== 0),
			).length,
		};
	},
});
