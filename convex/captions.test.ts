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
	registerWorkpool(t, "captionRetryWorkpool");

	return t;
}

type CaptionTest = ReturnType<typeof makeTest>;

const workId = (value: string) => {
	// SAFETY: fixture strings stand in for workpool ids in tests that do not read the document.
	return value as WorkId;
};

async function readOperatorCommit(
	operator: ReturnType<CaptionTest["withIdentity"]>,
	sessionId: Id<"sessions">,
	acceptedCommitId: Id<"acceptedCommits">,
) {
	const { page } = await operator.query(api.captions.listOperatorCommits, {
		sessionId,
		paginationOpts: { numItems: 100, cursor: null },
	});

	return page.find((commit) => commit.acceptedCommitId === acceptedCommitId);
}

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

async function finishOnlyTarget(
	t: CaptionTest,
	operator: ReturnType<CaptionTest["withIdentity"]>,
	acceptedCommitId: Id<"acceptedCommits">,
	kind: "translated" | "failed",
) {
	const [target] = await acceptedTargets(t, acceptedCommitId);

	if (!target?.workId) throw new Error("Expected a translation job");

	const completion =
		kind === "translated"
			? {
					kind,
					targetId: target._id,
					targetLanguage: target.targetLanguage,
					translation: "Repaired",
				}
			: {
					kind,
					targetId: target._id,
					targetLanguage: target.targetLanguage,
					error: "Provider unavailable",
				};

	const event = {
		workId: workId(target.workId),
		context: { acceptedCommitId },
		result: { kind: "success" as const, returnValue: completion },
	};

	await operator.mutation(internal.captions.targetCompleted, event);

	return event;
}

describe("Convex-owned caption acceptance", () => {
	it("seals only after reverse-order translated and failed first outcomes finish", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const first = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "first",
			sourceText: "First",
			sourceLanguage: "en",
		});

		const second = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 2,
			commitId: "second",
			sourceText: "Second",
			sourceLanguage: "en",
		});

		await operator.mutation(api.broadcasts.stop, {
			broadcastId,
			finalCommitOrdinal: 2,
		});
		await finishOnlyTarget(t, operator, second.acceptedCommitId, "failed");
		expect(
			await operator.query(api.sessions.getMineBySlug, {
				slug: "caption-event",
			}),
		).toMatchObject({
			activeBroadcast: { status: "stopping" },
		});
		await finishOnlyTarget(t, operator, first.acceptedCommitId, "translated");
		expect(
			await operator.query(api.sessions.getMineBySlug, {
				slug: "caption-event",
			}),
		).toMatchObject({ activeBroadcast: null });

		const captions = await operator.query(api.captions.listOperatorCommits, {
			sessionId,
			paginationOpts: { numItems: 10, cursor: null },
		});

		expect(
			captions.page.map((commit) => [commit.commitId, commit.status]),
		).toEqual([
			["second", "failed"],
			["first", "translated"],
		]);
	});
	it.each([
		"identity",
		"translation",
		"failure",
	] as const)("rolls back a malformed %s completion through the registered mutation", async (invalid) => {
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
			sourceText: "Remain pending",
			sourceLanguage: "en",
		});

		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!target?.workId) throw new Error("Expected a translation job");

		const completion =
			invalid === "failure"
				? {
						kind: "failed" as const,
						targetId: target._id,
						targetLanguage: target.targetLanguage,
						error: " ",
					}
				: {
						kind: "translated" as const,
						targetId: target._id,
						targetLanguage:
							invalid === "identity" ? "de" : target.targetLanguage,
						translation: invalid === "translation" ? "" : "Translated",
					};

		await expect(
			operator.mutation(internal.captions.targetCompleted, {
				workId: workId(target.workId),
				context: { acceptedCommitId: accepted.acceptedCommitId },
				result: { kind: "success", returnValue: completion },
			}),
		).rejects.toThrow(
			{
				identity: "Translation completion identity mismatch",
				translation: "Translated completion has no translation",
				failure: "Failed completion has no error classification",
			}[invalid],
		);
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({ status: "pending", segmentId: null });
	});

	it("drains mixed first outcomes without counting synchronous zero-target publication", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
		]);

		await t.run((ctx) =>
			ctx.db.patch(sessionId, { spokenLanguages: ["en", "ja"] }),
		);

		const pending = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "first-pending",
			sourceText: "Translate first",
			sourceLanguage: "ja",
		});

		const immediate = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 2,
			commitId: "second-synchronous",
			sourceText: "Already in audience language",
			sourceLanguage: "en",
		});

		expect(immediate.status).toBe("translated");
		expect(
			await operator.mutation(api.broadcasts.stop, { broadcastId }),
		).toMatchObject({ status: "stopping", finalCommitOrdinal: 2 });
		await finishOnlyTarget(t, operator, pending.acceptedCommitId, "failed");
		expect(
			await operator.mutation(api.broadcasts.stop, { broadcastId }),
		).toMatchObject({ status: "sealed", finalCommitOrdinal: 2 });
	});

	it("rolls back a terminal outcome when first-publication accounting underflows", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "underflow",
			sourceText: "Must remain pending",
			sourceLanguage: "en",
		});

		await t.run((ctx) => ctx.db.patch(broadcastId, { pendingCommitCount: 0 }));
		await expect(
			finishOnlyTarget(t, operator, accepted.acceptedCommitId, "translated"),
		).rejects.toThrow("Broadcast pending commit count underflow");
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "pending",
			segmentId: null,
			completedTargetCount: 0,
		});
		expect(
			await operator.query(api.segments.listBySession, {
				sessionId,
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).toMatchObject({ page: [] });
		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);
		expect(target).toMatchObject({
			status: "pending",
			workId: expect.any(String),
		});
	});

	it.each([
		"Segment",
		"Broadcast",
	] as const)("rejects repair when the stored %s reference is missing", async (missing) => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "missing-segment",
			sourceText: "Corrupted outcome",
			sourceLanguage: "en",
		});

		await finishOnlyTarget(t, operator, accepted.acceptedCommitId, "failed");

		const finished = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

		if (!finished?.segmentId) throw new Error("Expected a finished Segment");
		const segmentId = finished.segmentId;
		await t.run((ctx) =>
			ctx.db.delete(missing === "Segment" ? segmentId : broadcastId),
		);
		await expect(
			operator.mutation(api.captions.retryCommit, {
				acceptedCommitId: accepted.acceptedCommitId,
			}),
		).rejects.toThrow(
			missing === "Segment"
				? "Accepted commit references a missing Segment"
				: "Accepted commit references a missing or wrong Broadcast",
		);
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({ status: "failed" });
	});

	it.each([
		"missing",
		"translated",
	] as const)("rejects repair with a corrupt %s target set", async (corruption) => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "corrupt-targets",
			sourceText: "Fallback",
			sourceLanguage: "en",
		});

		await finishOnlyTarget(t, operator, accepted.acceptedCommitId, "failed");
		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!target) throw new Error("Expected target");
		await t.run(async (ctx) => {
			if (corruption === "missing") await ctx.db.delete(target._id);
			else
				await ctx.db.patch(target._id, {
					status: "translated",
					translation: "Done",
				});
		});
		await expect(
			operator.mutation(api.captions.retryCommit, {
				acceptedCommitId: accepted.acceptedCommitId,
			}),
		).rejects.toThrow(
			corruption === "missing"
				? "Accepted commit targets are unavailable"
				: "Failed Accepted commit has inconsistent target state",
		);
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({ status: "failed" });
	});

	it.each([
		"missing",
		"invalid",
	] as const)("rolls back repair completion with a %s Broadcast", async (corruption) => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "repair-corruption",
			sourceText: "Fallback",
			sourceLanguage: "en",
		});

		await finishOnlyTarget(t, operator, accepted.acceptedCommitId, "failed");
		await operator.mutation(api.captions.retryCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});
		await t.run(async (ctx) => {
			if (corruption === "missing") await ctx.db.delete(broadcastId);
			else await ctx.db.patch(broadcastId, { pendingCommitCount: -1 });
		});
		await expect(
			finishOnlyTarget(t, operator, accepted.acceptedCommitId, "translated"),
		).rejects.toThrow(
			corruption === "missing"
				? "Accepted commit references a missing or wrong Broadcast"
				: "Broadcast pending commit count is negative",
		);
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "pending",
			segmentStatus: "failed",
			translations: {},
		});
		expect(await acceptedTargets(t, accepted.acceptedCommitId)).toMatchObject([
			{ status: "pending" },
		]);
	});

	it.each([
		{ count: -1, error: "Broadcast pending commit count is negative" },
		{
			count: 0.5,
			error: "Broadcast pending commit count is not a safe integer",
		},
		{
			count: 1,
			error: "Broadcast pending commit count exceeds accepted positions",
		},
	])("rejects acceptance into invalid persisted Broadcast accounting ($count)", async ({
		count,
		error,
	}) => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		await t.run((ctx) =>
			ctx.db.patch(broadcastId, { pendingCommitCount: count }),
		);
		await expect(
			operator.mutation(api.captions.acceptCommit, {
				sessionId,
				broadcastId,
				commitOrdinal: 1,
				commitId: "invalid-accounting",
				sourceText: "Never accepted",
				sourceLanguage: "en",
			}),
		).rejects.toThrow(error);
		expect(
			await operator.query(api.captions.listOperatorCommits, {
				sessionId,
				paginationOpts: { numItems: 10, cursor: null },
			}),
		).toMatchObject({ page: [] });
	});

	it.each([
		"active",
		"lost",
		"stopping",
		"sealed",
	] as const)("repairs a failed caption in a %s Broadcast without changing its position or drain", async (status) => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const capture = {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "repair-in-any-state",
			sourceText: "Repair later",
			sourceLanguage: "en",
		};

		const accepted = await operator.mutation(
			api.captions.acceptCommit,
			capture,
		);

		const [liveTarget] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!liveTarget) throw new Error("Expected a live translation target");
		// convex-test generates component-local IDs; distinguish the completed live job from a retry pool job.
		await t.run((ctx) =>
			ctx.db.patch(liveTarget._id, { workId: "completed-live-job" }),
		);

		const oldCompletion = await finishOnlyTarget(
			t,
			operator,
			accepted.acceptedCommitId,
			"failed",
		);

		const finished = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

		let unfinishedId: Id<"acceptedCommits"> | undefined;

		if (status === "stopping") {
			const unfinished = await operator.mutation(api.captions.acceptCommit, {
				...capture,
				commitOrdinal: 2,
				commitId: "unfinished-initial",
			});

			unfinishedId = unfinished.acceptedCommitId;
		}

		if (status === "sealed" || status === "stopping")
			await operator.mutation(api.broadcasts.stop, { broadcastId });

		if (status === "lost") {
			await t.run((ctx) =>
				ctx.db.patch(broadcastId, { lastHeartbeatAt: Date.now() - 20_001 }),
			);
			await operator.mutation(internal.broadcasts.markLost, { broadcastId });
		}

		if (status === "sealed")
			await operator.mutation(api.broadcasts.start, { sessionId });

		const retried = await operator.mutation(api.captions.retryCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(retried).toMatchObject({
			status: "pending",
			segmentId: finished?.segmentId,
		});
		expect(
			await operator.mutation(api.captions.retryCommit, {
				acceptedCommitId: accepted.acceptedCommitId,
			}),
		).toEqual(retried);
		await operator.mutation(internal.captions.targetCompleted, oldCompletion);
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "pending",
			broadcastId,
			commitOrdinal: 1,
			broadcastSequence: 1,
			segmentId: finished?.segmentId,
		});

		if (unfinishedId)
			await finishOnlyTarget(t, operator, unfinishedId, "translated");

		if (status === "sealed" || status === "stopping")
			expect(
				await operator.mutation(api.broadcasts.stop, { broadcastId }),
			).toMatchObject({ status: "sealed" });
		await finishOnlyTarget(
			t,
			operator,
			accepted.acceptedCommitId,
			"translated",
		);
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "translated",
			broadcastId,
			commitOrdinal: 1,
			broadcastSequence: 1,
			segmentId: finished?.segmentId,
		});
		const replay = await operator.mutation(api.captions.acceptCommit, capture);
		expect(replay).toMatchObject({
			status: "translated",
			acceptedCommitId: accepted.acceptedCommitId,
		});

		const session = await operator.query(api.sessions.getMineBySlug, {
			slug: "caption-event",
		});

		expect(session?.activeBroadcast?.status).toBe(
			{ active: "active", lost: "lost", stopping: undefined, sealed: "active" }[
				status
			],
		);

		if (status === "sealed") expect(session?.activeBroadcast?.sequence).toBe(2);
	});

	it.each([
		true,
		false,
	])("serializes deletion and repair admission when retry wins: %s", async (retryFirst) => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "repair-deletion-race",
			sourceText: "Repair or delete",
			sourceLanguage: "en",
		});

		await finishOnlyTarget(t, operator, accepted.acceptedCommitId, "failed");
		await operator.mutation(api.broadcasts.stop, { broadcastId });

		if (retryFirst) {
			await operator.mutation(api.captions.retryCommit, {
				acceptedCommitId: accepted.acceptedCommitId,
			});
			await expect(
				operator.mutation(api.sessions.deleteSession, { sessionId }),
			).rejects.toMatchObject({ data: { code: "session_busy" } });
			await finishOnlyTarget(t, operator, accepted.acceptedCommitId, "failed");
			await expect(
				operator.mutation(api.sessions.deleteSession, { sessionId }),
			).resolves.toBeNull();
		} else {
			await operator.mutation(api.sessions.deleteSession, { sessionId });
			await expect(
				operator.mutation(api.captions.retryCommit, {
					acceptedCommitId: accepted.acceptedCommitId,
				}),
			).rejects.toMatchObject({ data: { code: "session_deleting" } });
		}
	});

	it("seals after a first failed outcome while its retry is pending", async () => {
		const t = makeTest();

		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t, [
			"en",
			"ja",
		]);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "repair-before-stop",
			sourceText: "Repair later",
			sourceLanguage: "en",
		});

		const [target] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!target?.workId) throw new Error("Expected a translation job");
		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId(target.workId),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "failed",
					targetId: target._id,
					targetLanguage: target.targetLanguage,
					error: "Provider unavailable",
				},
			},
		});

		const retried = await operator.mutation(api.captions.retryCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(retried.status).toBe("pending");
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "pending",
			segmentStatus: "failed",
			segmentId: retried.segmentId,
		});
		expect(
			await operator.mutation(api.broadcasts.stop, { broadcastId }),
		).toMatchObject({ status: "sealed", finalCommitOrdinal: 1 });
		const [repairTarget] = await acceptedTargets(t, accepted.acceptedCommitId);

		if (!repairTarget?.workId) throw new Error("Expected a retry job");
		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId(repairTarget.workId),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: repairTarget._id,
					targetLanguage: repairTarget.targetLanguage,
					translation: "Repaired",
				},
			},
		});
		expect(
			await operator.mutation(api.broadcasts.stop, { broadcastId }),
		).toMatchObject({ status: "sealed", finalCommitOrdinal: 1 });
		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "translated",
			segmentId: retried.segmentId,
			translations: { ja: "Repaired" },
		});
	});

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

	it("retries only failed targets and keeps finished translations", async () => {
		const t = makeTest();
		const { operator, sessionId, broadcastId } = await seedCaptionBroadcast(t);

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId,
			commitOrdinal: 1,
			commitId: "partial-retry",
			sourceText: "Retry one language",
			sourceLanguage: "en",
		});

		const [german, japanese] = await acceptedTargets(
			t,
			accepted.acceptedCommitId,
		);

		if (!german?.workId || !japanese?.workId) {
			throw new Error("Expected two scheduled targets");
		}

		for (const [target, returnValue] of [
			[
				japanese,
				{
					kind: "translated" as const,
					targetId: japanese._id,
					targetLanguage: japanese.targetLanguage,
					translation: "言語",
				},
			],
			[
				german,
				{
					kind: "failed" as const,
					targetId: german._id,
					targetLanguage: german.targetLanguage,
					error: "Provider rejected the request",
				},
			],
		] as const) {
			await operator.mutation(internal.captions.targetCompleted, {
				workId: workId(target.workId ?? ""),
				context: { acceptedCommitId: accepted.acceptedCommitId },
				result: { kind: "success", returnValue },
			});
		}

		const retried = await operator.mutation(api.captions.retryCommit, {
			acceptedCommitId: accepted.acceptedCommitId,
		});

		expect(retried).toMatchObject({
			status: "pending",
			completedTargetCount: 1,
			failedTargetCount: 0,
		});

		const [retriedGerman, keptJapanese] = await acceptedTargets(
			t,
			accepted.acceptedCommitId,
		);

		expect(keptJapanese).toMatchObject({
			status: "translated",
			translation: "言語",
		});
		expect(keptJapanese?.workId).toBeUndefined();
		expect(retriedGerman).toMatchObject({ status: "pending" });

		if (!retriedGerman?.workId) throw new Error("Expected a retry job");
		await operator.mutation(internal.captions.targetCompleted, {
			workId: workId(retriedGerman.workId),
			context: { acceptedCommitId: accepted.acceptedCommitId },
			result: {
				kind: "success",
				returnValue: {
					kind: "translated",
					targetId: retriedGerman._id,
					targetLanguage: retriedGerman.targetLanguage,
					translation: "Sprache",
				},
			},
		});

		expect(
			await readOperatorCommit(operator, sessionId, accepted.acceptedCommitId),
		).toMatchObject({
			status: "translated",
			translations: { de: "Sprache", ja: "言語" },
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

			const finished = await readOperatorCommit(
				operator,
				sessionId,
				accepted.acceptedCommitId,
			);

			expect(finished).toMatchObject({
				status: "failed",
				failedTargetCount: 2,
			});
		} finally {
			vi.useRealTimers();
		}
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

		const partial = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

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

		const finished = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

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

		const commit = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

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

		const pending = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

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

		const recovered = await readOperatorCommit(
			operator,
			sessionId,
			accepted.acceptedCommitId,
		);

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
