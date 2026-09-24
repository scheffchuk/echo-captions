/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function makeTest() {
	const t = convexTest(schema, modules);
	registerWorkpool(t, "captionWorkpool");
	registerWorkpool(t, "captionRetryWorkpool");

	return t;
}

type MappingTest = ReturnType<typeof makeTest>;

function identityFor(userId: Id<"users">) {
	return {
		issuer: "https://auth.example",
		subject: `${userId}|authSessions:mapping-test`,
		tokenIdentifier: `https://auth.example|${userId}|authSessions:mapping-test`,
	};
}

async function seedOperator(t: MappingTest) {
	const operatorId = await t.run(async (ctx) => {
		return await ctx.db.insert("users", {
			email: "operator@echo.example",
			name: "Operator",
		});
	});

	return t.withIdentity(identityFor(operatorId));
}

describe("versioned translation mappings", () => {
	it("stores canonical revisions and treats equivalent saves as no-ops", async () => {
		const t = makeTest();
		const operator = await seedOperator(t);

		const created = await operator.mutation(api.sessions.create, {
			title: "Mapping event",
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja"],
			translationMappings: [
				{
					term: "  cafe\u0301 ",
					targetLanguage: "JA-JP",
					translation: "  カフェ ",
				},
			],
		});

		const first = await operator.query(api.sessions.getMineBySlug, {
			slug: created.slug,
		});

		if (!first) throw new Error("Expected created Session");
		const firstRevisionId = first.translationMappingRevisionId;

		if (!firstRevisionId) throw new Error("Expected a mapping revision");

		expect(first.translationMappings).toEqual([
			{ term: "café", targetLanguage: "ja", translation: "カフェ" },
		]);

		const equivalent = await operator.mutation(
			api.sessions.updateTranslationMappings,
			{
				sessionId: first._id,
				expectedRevisionId: firstRevisionId,
				translationMappings: [
					{ term: "café", targetLanguage: "ja", translation: "カフェ" },
				],
			},
		);

		expect(equivalent).toEqual({
			revisionId: firstRevisionId,
			changed: false,
		});

		const revision = await t.run((ctx) =>
			ctx.db.get("translationMappingRevisions", firstRevisionId),
		);

		expect(revision).toMatchObject({
			revision: 1,
			mappings: first.translationMappings,
		});
	});

	it("rejects stale saves, preserves empty-revision semantics, and creates no empty revision", async () => {
		const t = makeTest();
		const operator = await seedOperator(t);

		const created = await operator.mutation(api.sessions.create, {
			title: "Conflict event",
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja"],
		});

		const session = await operator.query(api.sessions.getMineBySlug, {
			slug: created.slug,
		});

		if (!session) throw new Error("Expected created Session");

		const firstSave = await operator.mutation(
			api.sessions.updateTranslationMappings,
			{
				sessionId: session._id,
				expectedRevisionId: null,
				translationMappings: [
					{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
				],
			},
		);

		if (!firstSave.revisionId) throw new Error("Expected first revision");

		const staleError = await operator
			.mutation(api.sessions.updateTranslationMappings, {
				sessionId: session._id,
				expectedRevisionId: null,
				translationMappings: [],
			})
			.catch((cause: unknown) => cause);

		expect(staleError).toMatchObject({
			data: { code: "mapping_revision_conflict" },
		});

		const cleared = await operator.mutation(
			api.sessions.updateTranslationMappings,
			{
				sessionId: session._id,
				expectedRevisionId: firstSave.revisionId,
				translationMappings: [],
			},
		);

		expect(cleared).toEqual({ revisionId: null, changed: true });
		expect(
			await operator.mutation(api.sessions.updateTranslationMappings, {
				sessionId: session._id,
				expectedRevisionId: null,
				translationMappings: [],
			}),
		).toEqual({ revisionId: null, changed: false });

		const revisions = await t.run(async (ctx) =>
			ctx.db
				.query("translationMappingRevisions")
				.withIndex("by_session_id_and_revision", (q) =>
					q.eq("sessionId", session._id),
				)
				.take(2),
		);

		expect(revisions).toHaveLength(1);
	});

	it("keeps the revision when adding a language and drops mappings removed from the audience", async () => {
		const t = makeTest();
		const operator = await seedOperator(t);

		const created = await operator.mutation(api.sessions.create, {
			title: "Language event",
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja"],
			translationMappings: [
				{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
			],
		});

		const session = await operator.query(api.sessions.getMineBySlug, {
			slug: created.slug,
		});

		if (!session?.translationMappingRevisionId) {
			throw new Error("Expected mapping revision");
		}

		const revisionId = session.translationMappingRevisionId;

		await operator.mutation(api.sessions.updateLanguages, {
			sessionId: session._id,
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja", "de"],
		});

		const withAddedLanguage = await operator.query(api.sessions.getMineBySlug, {
			slug: created.slug,
		});

		expect(withAddedLanguage?.translationMappingRevisionId).toBe(revisionId);

		await operator.mutation(api.sessions.updateLanguages, {
			sessionId: session._id,
			spokenLanguages: ["en"],
			audienceLanguagesExtra: [],
		});

		const withRemovedLanguage = await operator.query(
			api.sessions.getMineBySlug,
			{
				slug: created.slug,
			},
		);

		expect(withRemovedLanguage?.translationMappingRevisionId).toBeUndefined();
		expect(withRemovedLanguage?.translationMappings).toEqual([]);
	});

	it("captures the current revision when each commit is accepted", async () => {
		const t = makeTest();
		const operator = await seedOperator(t);

		const created = await operator.mutation(api.sessions.create, {
			title: "Live mapping event",
			spokenLanguages: ["en"],
			audienceLanguagesExtra: ["ja"],
			translationMappings: [
				{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
			],
		});

		const session = await operator.query(api.sessions.getMineBySlug, {
			slug: created.slug,
		});

		if (!session?.translationMappingRevisionId) {
			throw new Error("Expected mapping revision");
		}

		const started = await operator.mutation(api.broadcasts.start, {
			sessionId: session._id,
		});

		const firstCommit = await operator.mutation(api.captions.acceptCommit, {
			sessionId: session._id,
			broadcastId: started.broadcastId,
			commitOrdinal: 1,
			commitId: "mapping-commit-1",
			sourceText: "Echo one",
			sourceLanguage: "en",
		});

		const updated = await operator.mutation(
			api.sessions.updateTranslationMappings,
			{
				sessionId: session._id,
				expectedRevisionId: session.translationMappingRevisionId,
				translationMappings: [
					{ term: "Echo", targetLanguage: "ja", translation: "反響" },
				],
			},
		);

		if (!updated.revisionId) throw new Error("Expected updated revision");

		const secondCommit = await operator.mutation(api.captions.acceptCommit, {
			sessionId: session._id,
			broadcastId: started.broadcastId,
			commitOrdinal: 2,
			commitId: "mapping-commit-2",
			sourceText: "Echo two",
			sourceLanguage: "en",
		});

		const snapshots = await t.run(async (ctx) => ({
			first: await ctx.db.get("acceptedCommits", firstCommit.acceptedCommitId),
			second: await ctx.db.get(
				"acceptedCommits",
				secondCommit.acceptedCommitId,
			),
		}));

		expect(snapshots.first?.translationMappingRevisionId).toBe(
			session.translationMappingRevisionId,
		);
		expect(snapshots.second?.translationMappingRevisionId).toBe(
			updated.revisionId,
		);
	});
});
