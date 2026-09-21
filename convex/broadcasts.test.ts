/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import type { WorkId } from "@convex-dev/workpool";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function makeTest() {
	const t = convexTest(schema, modules);
	registerWorkpool(t, "captionWorkpool");
	return t;
}

type BroadcastTest = ReturnType<typeof makeTest>;

function identityFor(userId: Id<"users">) {
	return {
		issuer: "https://auth.example",
		subject: `${userId}|authSessions:broadcast-test`,
		tokenIdentifier: `https://auth.example|${userId}|authSessions:broadcast-test`,
	};
}

async function seedOperator(t: BroadcastTest) {
	const operatorId = await t.run(async (ctx) => {
		return await ctx.db.insert("users", {
			email: "operator@echo.example",
			name: "Operator",
		});
	});

	const insertSession = async (slug: string) =>
		await t.run(async (ctx) =>
			ctx.db.insert("sessions", {
				title: slug,
				slug,
				ownerId: operatorId,
				spokenLanguages: ["en"],
				audienceLanguages: ["en"],
				lastCommitSequence: 0,
				lastBroadcastSequence: 0,
			}),
		);

	return {
		operator: t.withIdentity(identityFor(operatorId)),
		sessionId: await insertSession("broadcast-test"),
		insertSession,
	};
}

async function completeAcceptedCommit(
	t: BroadcastTest,
	operator: ReturnType<BroadcastTest["withIdentity"]>,
	acceptedCommitId: Id<"acceptedCommits">,
) {
	const target = await t.run(async (ctx) =>
		ctx.db
			.query("acceptedCommitTargets")
			.withIndex("by_accepted_commit_id_and_target_language", (q) =>
				q.eq("acceptedCommitId", acceptedCommitId),
			)
			.unique(),
	);
	if (!target?.workId)
		throw new Error("Expected one queued translation target");
	await operator.mutation(internal.captions.targetCompleted, {
		workId: target.workId as WorkId,
		context: { acceptedCommitId },
		result: {
			kind: "success",
			returnValue: {
				kind: "translated",
				targetId: target._id,
				targetLanguage: target.targetLanguage,
				translation: "Translated",
			},
		},
	});
}

describe("Broadcast lifecycle", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("atomically allows one active Broadcast per Session", async () => {
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);

		const results = await Promise.allSettled([
			operator.mutation(api.broadcasts.start, { sessionId }),
			operator.mutation(api.broadcasts.start, { sessionId }),
		]);

		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const successful = results.find((result) => result.status === "fulfilled");
		if (successful?.status !== "fulfilled") {
			throw new Error("Expected one successful Broadcast start");
		}

		expect(successful.value.sequence).toBe(1);
		expect(successful.value.broadcastId).toBeTruthy();
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.isLive,
		).toBe(true);
	});

	it("keeps Broadcast sequences independent across Sessions", async () => {
		const t = makeTest();
		const { operator, sessionId, insertSession } = await seedOperator(t);
		const secondSessionId = await insertSession("second-broadcast-test");

		const [first, second] = await Promise.all([
			operator.mutation(api.broadcasts.start, { sessionId }),
			operator.mutation(api.broadcasts.start, { sessionId: secondSessionId }),
		]);

		expect(first.sequence).toBe(1);
		expect(second.sequence).toBe(1);
		expect(first.broadcastId).not.toBe(second.broadcastId);
	});

	it("uses the server-known ordinal when stopping without a client ordinal", async () => {
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});

		const stopped = await operator.mutation(api.broadcasts.stop, {
			broadcastId: started.broadcastId,
		});

		expect(stopped).toMatchObject({
			broadcastId: started.broadcastId,
			status: "sealed",
			lastCommitOrdinal: 0,
			finalCommitOrdinal: 0,
		});
	});

	it("records heartbeats without changing Session activity", async () => {
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		const before = await t.run(async (ctx) => {
			const session = await ctx.db.get("sessions", sessionId);
			const broadcast = await ctx.db.get("broadcasts", started.broadcastId);
			return {
				lastActivityAt: session?.lastActivityAt,
				lastHeartbeatAt: broadcast?.lastHeartbeatAt,
			};
		});

		await operator.mutation(api.broadcasts.heartbeat, {
			broadcastId: started.broadcastId,
		});

		const after = await t.run(async (ctx) => {
			const session = await ctx.db.get("sessions", sessionId);
			const broadcast = await ctx.db.get("broadcasts", started.broadcastId);
			return {
				lastActivityAt: session?.lastActivityAt,
				lastHeartbeatAt: broadcast?.lastHeartbeatAt,
			};
		});

		expect(after.lastActivityAt).toBe(before.lastActivityAt);
		expect(after.lastHeartbeatAt).toBeGreaterThanOrEqual(
			before.lastHeartbeatAt ?? 0,
		);
	});

	it("classifies a silent active Broadcast as Lost after the heartbeat timeout", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		await operator.mutation(api.broadcasts.start, { sessionId });

		vi.advanceTimersByTime(19_999);
		await t.finishInProgressScheduledFunctions();
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.activeBroadcast?.status,
		).toBe("active");

		vi.advanceTimersByTime(1);
		await t.finishInProgressScheduledFunctions();
		expect(
			await operator.query(api.sessions.getMineBySlug, {
				slug: "broadcast-test",
			}),
		).toMatchObject({
			isLive: false,
			activeBroadcast: { status: "lost" },
		});
	});

	it("does not let a late heartbeat revive an expired Broadcast", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});

		vi.advanceTimersByTime(20_000);
		await operator.mutation(api.broadcasts.heartbeat, {
			broadcastId: started.broadcastId,
		});
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.activeBroadcast?.status,
		).toBe("lost");

		await t.finishInProgressScheduledFunctions();
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.activeBroadcast?.status,
		).toBe("lost");
	});

	it("ignores a stale expiry after a heartbeat and resumes a Lost Broadcast in order", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "recovery-commit-1",
			sourceText: "First",
			sourceLanguage: "en",
		});

		vi.advanceTimersByTime(19_999);
		await operator.mutation(api.broadcasts.heartbeat, {
			broadcastId: started.broadcastId,
		});
		vi.advanceTimersByTime(1);
		await t.finishInProgressScheduledFunctions();
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.activeBroadcast?.status,
		).toBe("active");

		vi.advanceTimersByTime(19_999);
		await t.finishInProgressScheduledFunctions();
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.activeBroadcast?.status,
		).toBe("lost");

		const resumed = await operator.mutation(api.broadcasts.resume, {
			broadcastId: started.broadcastId,
		});
		expect(resumed).toMatchObject({
			broadcastId: started.broadcastId,
			sequence: 1,
			status: "active",
			lastCommitOrdinal: 1,
		});

		const secondCommit = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 2,
			commitId: "recovery-commit-2",
			sourceText: "Second",
			sourceLanguage: "en",
		});
		expect(secondCommit).toMatchObject({
			commitId: "recovery-commit-2",
			status: "translated",
		});
	});

	it("abandons a Lost Broadcast at the highest server-known ordinal", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "abandon-commit-1",
			sourceText: "Known",
			sourceLanguage: "en",
		});

		vi.advanceTimersByTime(20_000);
		await t.finishInProgressScheduledFunctions();
		await expect(
			operator.mutation(api.broadcasts.start, { sessionId }),
		).rejects.toThrow();

		const abandoned = await operator.mutation(api.broadcasts.abandon, {
			broadcastId: started.broadcastId,
		});
		expect(abandoned).toMatchObject({
			broadcastId: started.broadcastId,
			sequence: 1,
			status: "sealed",
			lastCommitOrdinal: 1,
			finalCommitOrdinal: 1,
		});
		await expect(
			operator.mutation(api.broadcasts.abandon, {
				broadcastId: started.broadcastId,
			}),
		).resolves.toEqual(abandoned);
		await expect(
			operator.mutation(api.broadcasts.start, { sessionId }),
		).resolves.toMatchObject({ sequence: 2 });
	});

	it("waits for in-flight commits before sealing an abandoned tail", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { audienceLanguages: ["en", "ja"] }),
		);
		const pending = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "abandon-pending-1",
			sourceText: "Pending",
			sourceLanguage: "en",
		});

		vi.advanceTimersByTime(20_000);
		await operator.mutation(internal.broadcasts.markLost, {
			broadcastId: started.broadcastId,
		});
		const abandoned = await operator.mutation(api.broadcasts.abandon, {
			broadcastId: started.broadcastId,
		});
		expect(abandoned).toMatchObject({
			status: "stopping",
			lastCommitOrdinal: 1,
			finalCommitOrdinal: 1,
		});
		await expect(
			operator.mutation(api.broadcasts.start, { sessionId }),
		).rejects.toThrow();

		await completeAcceptedCommit(t, operator, pending.acceptedCommitId);
		await expect(
			operator.mutation(api.broadcasts.start, { sessionId }),
		).resolves.toMatchObject({ sequence: 2 });
	});

	it("rejects abandoning a Broadcast that is already stopping", async () => {
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});

		await t.run(async (ctx) =>
			ctx.db.patch(sessionId, { audienceLanguages: ["en", "ja"] }),
		);
		await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "abandon-stopping-1",
			sourceText: "Pending",
			sourceLanguage: "en",
		});
		await operator.mutation(api.broadcasts.stop, {
			broadcastId: started.broadcastId,
			finalCommitOrdinal: 1,
		});

		await expect(
			operator.mutation(api.broadcasts.abandon, {
				broadcastId: started.broadcastId,
			}),
		).rejects.toMatchObject({ data: { code: "broadcast_not_lost" } });
	});

	it("keeps deleted Session slugs permanently reserved", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator } = await seedOperator(t);
		const created = await operator.mutation(api.sessions.create, {
			title: "Reserved slug event",
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja"],
		});
		const session = await operator.query(api.sessions.getMineBySlug, {
			slug: created.slug,
		});
		if (!session) throw new Error("Expected created Session");

		const reservationBeforeDelete = await t.run(async (ctx) =>
			ctx.db
				.query("sessionSlugs")
				.withIndex("by_slug", (q) => q.eq("slug", created.slug))
				.unique(),
		);
		expect(reservationBeforeDelete?.slug).toBe(created.slug);

		await operator.mutation(api.sessions.deleteSession, {
			sessionId: session._id,
		});
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
		expect(
			await operator.query(api.sessions.getMineBySlug, {
				slug: created.slug,
			}),
		).toBeNull();

		const reservationAfterDelete = await t.run(async (ctx) =>
			ctx.db
				.query("sessionSlugs")
				.withIndex("by_slug", (q) => q.eq("slug", created.slug))
				.unique(),
		);
		expect(reservationAfterDelete?.slug).toBe(created.slug);
	});

	it("protects Session deletion until a Lost Broadcast is abandoned", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		vi.advanceTimersByTime(20_000);
		await t.finishInProgressScheduledFunctions();

		await expect(
			operator.mutation(api.sessions.deleteSession, { sessionId }),
		).rejects.toThrow();
		await operator.mutation(api.broadcasts.abandon, {
			broadcastId: started.broadcastId,
		});
		await operator.mutation(api.sessions.deleteSession, { sessionId });
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
		expect(
			await operator.query(api.sessions.getMineBySlug, {
				slug: "broadcast-test",
			}),
		).toBeNull();
	});

	it("serializes Session deletion against a new Broadcast start", async () => {
		vi.useFakeTimers();
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const results = await Promise.allSettled([
			operator.mutation(api.broadcasts.start, { sessionId }),
			operator.mutation(api.sessions.deleteSession, { sessionId }),
		]);

		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const session = await t.run((ctx) => ctx.db.get("sessions", sessionId));
		const broadcast = await t.run(async (ctx) =>
			ctx.db
				.query("broadcasts")
				.withIndex("by_session_id_and_sequence", (q) =>
					q.eq("sessionId", sessionId),
				)
				.first(),
		);
		const deletionCommitted = session?.deletionRequestedAt !== undefined;
		const broadcastStarted = broadcast?.status === "active";
		expect(deletionCommitted !== broadcastStarted).toBe(true);
	});

	it("stops idempotently and seals only after the final ordinal is drained", async () => {
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { audienceLanguages: ["en", "ja"] }),
		);
		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "stop-commit-1",
			sourceText: "Hello",
			sourceLanguage: "en",
		});

		const waiting = await operator.mutation(api.broadcasts.stop, {
			broadcastId: started.broadcastId,
			finalCommitOrdinal: 1,
		});
		expect(waiting).toMatchObject({
			broadcastId: started.broadcastId,
			status: "stopping",
			finalCommitOrdinal: 1,
		});
		expect(
			(
				await operator.query(api.sessions.getMineBySlug, {
					slug: "broadcast-test",
				})
			)?.isLive,
		).toBe(false);
		await expect(
			operator.mutation(api.broadcasts.start, { sessionId }),
		).rejects.toThrow();

		await completeAcceptedCommit(t, operator, accepted.acceptedCommitId);

		const sealed = await operator.mutation(api.broadcasts.stop, {
			broadcastId: started.broadcastId,
			finalCommitOrdinal: 1,
		});
		expect(sealed).toMatchObject({
			broadcastId: started.broadcastId,
			status: "sealed",
			finalCommitOrdinal: 1,
		});

		const duplicate = await operator.mutation(api.broadcasts.stop, {
			broadcastId: started.broadcastId,
			finalCommitOrdinal: 1,
		});
		expect(duplicate).toEqual(sealed);

		await expect(
			operator.mutation(api.broadcasts.start, { sessionId }),
		).resolves.toMatchObject({ sequence: 2 });
	});

	it("orders accepted commits within the active Broadcast and seals after finalization", async () => {
		const t = makeTest();
		const { operator, sessionId } = await seedOperator(t);
		const started = await operator.mutation(api.broadcasts.start, {
			sessionId,
		});
		await t.run((ctx) =>
			ctx.db.patch(sessionId, { audienceLanguages: ["en", "ja"] }),
		);

		await expect(
			operator.mutation(api.captions.acceptCommit, {
				sessionId,
				broadcastId: started.broadcastId,
				commitOrdinal: 2,
				commitId: "commit-2",
				sourceText: "Second",
				sourceLanguage: "en",
			}),
		).rejects.toMatchObject({ data: { code: "broadcast_conflict" } });

		const accepted = await operator.mutation(api.captions.acceptCommit, {
			sessionId,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "commit-1",
			sourceText: "Hello",
			sourceLanguage: "en",
		});
		expect(accepted).toMatchObject({
			commitId: "commit-1",
			status: "pending",
		});

		await expect(
			operator.mutation(api.broadcasts.stop, {
				broadcastId: started.broadcastId,
				finalCommitOrdinal: 1,
			}),
		).resolves.toMatchObject({ status: "stopping" });

		await completeAcceptedCommit(t, operator, accepted.acceptedCommitId);

		const broadcast = await t.run((ctx) =>
			ctx.db.get("broadcasts", started.broadcastId),
		);
		expect(broadcast?.status).toBe("sealed");
	});
});
