/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import type { WorkId } from "@convex-dev/workpool";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function identityFor(userId: Id<"users">) {
	return {
		issuer: "https://auth.example",
		subject: `${userId}|authSessions:captions-test`,
		tokenIdentifier: `https://auth.example|${userId}|authSessions:captions-test`,
	};
}

function makeTest() {
	const t = convexTest(schema, modules);
	registerWorkpool(t, "captionWorkpool");

	return t;
}

type CaptionTest = ReturnType<typeof makeTest>;

const workId = (value: string) => {
	// SAFETY: fixture strings stand in for workpool ids in tests that do not read the document.
	return value as WorkId;
};

async function seedCaptionBroadcast(
	t: CaptionTest,
	audienceLanguages = ["en", "ja", "de"],
) {
	const operatorId = await t.run(async (ctx) => {
		return await ctx.db.insert("users", {
			email: "operator@echo.example",
			name: "Operator",
		});
	});

	const operator = t.withIdentity(identityFor(operatorId));

	const sessionId = await t.run(async (ctx) =>
		ctx.db.insert("sessions", {
			title: "Caption event",
			slug: "caption-event",
			ownerId: operatorId,
			spokenLanguages: ["en"],
			audienceLanguages,
			lastCommitSequence: 0,
			lastBroadcastSequence: 0,
		}),
	);

	const broadcast = await operator.mutation(api.broadcasts.start, {
		sessionId,
	});

	return { operator, sessionId, broadcastId: broadcast.broadcastId };
}

async function acceptedTargets(
	t: CaptionTest,
	acceptedCommitId: Id<"acceptedCommits">,
) {
	return await t.run(async (ctx) =>
		ctx.db
			.query("acceptedCommitTargets")
			.withIndex("by_accepted_commit_id_and_target_language", (q) =>
				q.eq("acceptedCommitId", acceptedCommitId),
			)
			.order("asc")
			.collect(),
	);
}

describe("Convex-owned caption acceptance", () => {
	it("accepts an idempotent commit and rejects a conflicting snapshot", async () => {
		const t = makeTest();
		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t);

		const args = {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "caption-1",
			sourceText: "Repeated source",
			sourceLanguage: "en",
		};

		const accepted = await operator.mutation(api.captions.acceptCommit, args);
		const duplicate = await operator.mutation(api.captions.acceptCommit, args);
		expect(duplicate).toEqual(accepted);
		expect(accepted.status).toBe("pending");
		expect(accepted.targetCount).toBe(2);

		const stored = await t.run(async (ctx) => ({
			commits: await ctx.db
				.query("acceptedCommits")
				.withIndex("by_session_id_and_commit_id", (q) =>
					q.eq("sessionId", sessionId).eq("commitId", "caption-1"),
				)
				.collect(),
			targets: await ctx.db
				.query("acceptedCommitTargets")
				.withIndex("by_accepted_commit_id_and_target_language", (q) =>
					q.eq("acceptedCommitId", accepted.acceptedCommitId),
				)
				.collect(),
		}));

		expect(stored.commits).toHaveLength(1);
		expect(stored.targets).toHaveLength(2);

		await expect(
			operator.mutation(api.captions.acceptCommit, {
				...args,
				sourceText: "Conflicting source",
			}),
		).rejects.toMatchObject({ data: { code: "commit_conflict" } });
	});

	it("keeps repeated source text distinct across accepted commits", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
		]);

		const first = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "repeated-source-1",
			sourceText: "The same words",
			sourceLanguage: "en",
		});

		const second = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 2,
			commitId: "repeated-source-2",
			sourceText: "The same words",
			sourceLanguage: "en",
		});

		expect(second.acceptedCommitId).not.toBe(first.acceptedCommitId);
		expect(second.sequence).toBe(first.sequence + 1);
	});

	it("defers explicit retries while live targets are pending", async () => {
		const t = makeTest();
		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t);

		const original = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "retry-priority",
			sourceText: "Retry later",
			sourceLanguage: "en",
		});

		const originalTargets = await acceptedTargets(t, original.acceptedCommitId);
		await t.run(async (ctx) => {
			for (const target of originalTargets) {
				await ctx.db.patch(target._id, {
					priority: "retry",
					status: "failed",
					error: "Provider failure",
				});
			}

			await ctx.db.patch(original.acceptedCommitId, {
				status: "failed",
				failedTargetCount: originalTargets.length,
			});
		});
		await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 2,
			commitId: "live-priority",
			sourceText: "Live first",
			sourceLanguage: "en",
		});

		await operator.mutation(api.captions.retryCommit, {
			acceptedCommitId: original.acceptedCommitId,
		});

		const retryTarget = (
			await acceptedTargets(t, original.acceptedCommitId)
		)[0];

		if (!retryTarget) throw new Error("Expected a retry target");
		expect(retryTarget.priority).toBe("retry");
		expect(retryTarget.workId).toBeUndefined();

		await expect(
			t.action(internal.captions.translateTarget, {
				targetId: retryTarget._id,
			}),
		).resolves.toMatchObject({
			kind: "deferred",
			targetId: retryTarget._id,
		});
	});

	it("executes Workpool targets and atomically publishes provider failures", async () => {
		vi.useFakeTimers();

		try {
			const t = makeTest();

			const { operator, sessionId, broadcastId } =
				await seedCaptionBroadcast(t);

			const accepted = await operator.mutation(api.captions.acceptCommit, {
				sessionId,
				broadcastId,
				commitOrdinal: 1,
				commitId: "workpool-execution",
				sourceText: "Provider is not configured",
				sourceLanguage: "en",
			});

			await t.finishAllScheduledFunctions(() => vi.runAllTimers());

			const finished = await operator.query(api.captions.getOperatorCommit, {
				acceptedCommitId: accepted.acceptedCommitId,
			});

			expect(finished).toMatchObject({
				status: "failed",
				failedTargetCount: 2,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reschedules provider backoff durably outside the running action", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "provider-backoff",
			sourceText: "Please retry later",
			sourceLanguage: "en",
		});

		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!target?.workId) throw new Error("Expected a scheduled target");
		const previousWorkId = target.workId;

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId(previousWorkId),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "deferred",
					targetId: target._id,
					targetLanguage: target.targetLanguage,
					retryAfterMillis: 60_000,
				},
			},
		});

		const [rescheduled] = await acceptedTargets(t, accepted.acceptedCommitId);
		expect(rescheduled).toMatchObject({
			status: "pending",
			providerAttemptCount: 1,
		});
		expect(rescheduled?.workId).toBeDefined();
		expect(rescheduled?.workId).not.toBe(previousWorkId);

		if (!rescheduled?.workId) throw new Error("Expected a rescheduled target");
		await t.run(async (ctx) => {
			await ctx.db.patch(rescheduled._id, { providerAttemptCount: 2 });
		});

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId(rescheduled.workId),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "deferred",
					targetId: rescheduled._id,
					targetLanguage: rescheduled.targetLanguage,
					retryAfterMillis: 60_000,
				},
			},
		});

		const [exhausted] = await acceptedTargets(t, accepted.acceptedCommitId);
		expect(exhausted).toMatchObject({
			status: "failed",
			error: "Translation retries exhausted",
		});
	});

	it("keeps partial target progress private until one atomic publication", async () => {
		const t = makeTest();
		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "caption-atomic",
			sourceText: "Same words",
			sourceLanguage: "en",
		});

		const targets = await acceptedTargets(t, accepted.acceptedCommitId);

		if (targets.length !== 2 || !targets[0] || !targets[1]) {
			throw new Error("Expected two translation targets");
		}

		await t.run(async (ctx) => {
			await ctx.db.patch(targets[0]._id, { workId: workId("caption-work-1") });
			await ctx.db.patch(targets[1]._id, { workId: workId("caption-work-2") });
		});

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId("caption-work-2"),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: targets[1]._id,
					targetLanguage: targets[1].targetLanguage,
					translation: "同じ言葉",
				},
			},
		});

		const partial = await operator.query(api.captions.getOperatorCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(partial).toMatchObject({
			status: "pending",
			completedTargetCount: 1,
			failedTargetCount: 0,
			segmentId: null,
			translations: {},
		});
		expect(
			await operator.query(api.segments.listBySession, {
				sessionId,
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).toMatchObject({ page: [] });

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId("caption-work-1"),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: targets[0]._id,
					targetLanguage: targets[0].targetLanguage,
					translation: "同じ言葉",
				},
			},
		});

		const finished = await operator.query(api.captions.getOperatorCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(finished).toMatchObject({
			status: "translated",
			completedTargetCount: 2,
			failedTargetCount: 0,
			translations: { de: "同じ言葉", ja: "同じ言葉" },
		});

		const publicSegments = await operator.query(api.segments.listBySession, {
			sessionId,
			paginationOpts: { numItems: 10, cursor: null },
		});

		expect(publicSegments.page).toHaveLength(1);

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId("caption-work-1"),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: targets[0]._id,
					targetLanguage: targets[0].targetLanguage,
					translation: "different replay",
				},
			},
		});

		const afterReplay = await t.run(async (ctx) => ({
			segments: await ctx.db.query("segments").collect(),
			broadcast: await ctx.db.get("broadcasts", broadcastId),
		}));

		expect(afterReplay.segments).toHaveLength(1);
		expect(afterReplay.broadcast?.pendingCommitCount).toBe(0);
	});

	it("publishes one failed Segment after a permanent target failure", async () => {
		const t = makeTest();
		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "caption-failure",
			sourceText: "Partial failure",
			sourceLanguage: "en",
		});

		const targets = await acceptedTargets(t, accepted.acceptedCommitId);

		if (targets.length !== 2 || !targets[0] || !targets[1]) {
			throw new Error("Expected two translation targets");
		}

		await t.run(async (ctx) => {
			await ctx.db.patch(targets[0]._id, {
				workId: workId("failure-work-1"),
			});
			await ctx.db.patch(targets[1]._id, {
				workId: workId("failure-work-2"),
			});
		});

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId("failure-work-1"),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: targets[0]._id,
					targetLanguage: targets[0].targetLanguage,
					translation: "部分",
				},
			},
		});
		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId("failure-work-2"),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "failed",
					targetId: targets[1]._id,
					targetLanguage: targets[1].targetLanguage,
					error: "Permanent provider failure",
				},
			},
		});

		const commit = await operator.query(api.captions.getOperatorCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(commit).toMatchObject({
			status: "failed",
			completedTargetCount: 1,
			failedTargetCount: 1,
			translations: {},
			error: "Translation failed",
		});

		const segments = await t.run(async (ctx) =>
			ctx.db.query("segments").collect(),
		);

		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({
			status: "failed",
			translations: {},
		});
	});

	it("throws when a translated completion violates its trusted contract", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "malformed-completion",
			sourceText: "Reject malformed success",
			sourceLanguage: "en",
		});

		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!target) throw new Error("Expected a translation target");
		await t.run(async (ctx) => {
			await ctx.db.patch(target._id, { workId: workId("malformed-work") });
		});

		await expect(
			operator.mutation(internal.captions.targetCompleted, {
				workId: workId("malformed-work"),
				context: { acceptedCommitId: accepted.acceptedCommitId },
				result: {
					kind: "success",
					returnValue: {
						kind: "translated",
						targetId: target._id,
						targetLanguage: target.targetLanguage,
						translation: "",
					},
				},
			}),
		).rejects.toThrow("Translated completion has no translation");
	});

	it("rejects a completion whose Workpool context names another commit", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const first = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "identity-first",
			sourceText: "First",
			sourceLanguage: "en",
		});

		const second = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 2,
			commitId: "identity-second",
			sourceText: "Second",
			sourceLanguage: "en",
		});

		const [target] = await acceptedTargets(t, first.acceptedCommitId);

		if (!target) throw new Error("Expected a translation target");
		await t.run(async (ctx) => {
			await ctx.db.patch(target._id, { workId: workId("identity-work") });
		});

		await expect(
			operator.mutation(internal.captions.targetCompleted, {
				workId: workId("identity-work"),
				context: { acceptedCommitId: second.acceptedCommitId },
				result: {
					kind: "success",
					returnValue: {
						kind: "translated",
						targetId: target._id,
						targetLanguage: target.targetLanguage,
						translation: "Wrong commit",
					},
				},
			}),
		).rejects.toThrow("Translation completion commit identity mismatch");
	});

	it("requeues a failed commit without changing its identity", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "caption-retry",
			sourceText: "Retry me",
			sourceLanguage: "en",
		});

		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!target) throw new Error("Expected a translation target");
		await t.run(async (ctx) => {
			await ctx.db.patch(target._id, { workId: workId("retry-work") });
		});

		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId("retry-work"),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "failed",
					targetId: target._id,
					targetLanguage: target.targetLanguage,
					error: "Provider rejected the request",
				},
			},
		});

		const failedSegment = await t.run(async (ctx) =>
			ctx.db.query("segments").first(),
		);

		if (!failedSegment) throw new Error("Expected a failed Segment");

		const retried = await operator.mutation(api.captions.retryCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(retried).toMatchObject({
			acceptedCommitId: accepted.acceptedCommitId,
			commitId: "caption-retry",
			status: "pending",
			completedTargetCount: 0,
			failedTargetCount: 0,
			segmentId: expect.any(String),
		});
		expect(retried.segmentId).toBe(failedSegment._id);

		const pending = await operator.query(api.captions.getOperatorCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(pending?.status).toBe("pending");
		expect(
			await operator.query(api.segments.listBySession, {
				sessionId,
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).toMatchObject({
			page: [{ sourceText: "Retry me", status: "failed" }],
		});
		const [retryTarget] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!retryTarget?.workId) throw new Error("Expected a retry Workpool job");
		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId(retryTarget.workId),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: retryTarget._id,
					targetLanguage: retryTarget.targetLanguage,
					translation: "Retried translation",
				},
			},
		});

		const recovered = await operator.query(api.captions.getOperatorCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(recovered).toMatchObject({
			status: "translated",
			segmentId: failedSegment._id,
			translations: { ja: "Retried translation" },
		});
		expect(
			await operator.query(api.segments.listBySession, {
				sessionId,
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).toMatchObject({
			page: [{ sourceText: "Retry me", status: "translated" }],
		});
	});

	it("finishes immediately when the source is the only audience language", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "caption-no-targets",
			sourceText: "No translation needed",
			sourceLanguage: "en",
		});

		expect(accepted).toMatchObject({
			status: "translated",
			targetCount: 0,
			completedTargetCount: 0,
			failedTargetCount: 0,
		});
		expect(
			await operator.query(api.segments.listBySession, {
				sessionId,
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).toMatchObject({ page: [{ sourceText: "No translation needed" }] });
	});
});
