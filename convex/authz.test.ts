/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
function identityFor(userId: Id<"users">) {
	return {
		issuer: "https://auth.example",
		subject: `${userId}|authSessions:test-session`,
		tokenIdentifier: `https://auth.example|${userId}|authSessions:test-session`,
	};
}

async function seedOperator(t: ReturnType<typeof convexTest>) {
	const operatorId = await t.run(async (ctx) => {
		return await ctx.db.insert("users", {
			email: "operator@echo.example",
			name: "Operator",
		});
	});
	const otherUserId = await t.run(async (ctx) => {
		return await ctx.db.insert("users", {
			email: "other@echo.example",
			name: "Other user",
		});
	});

	const sessionId = await t.run(async (ctx) => {
		return await ctx.db.insert("sessions", {
			title: "Protected session",
			slug: "protected-session",
			ownerId: operatorId,
			spokenLanguages: ["en"],
			audienceLanguages: ["en"],
			lastCommitSequence: 0,
			lastBroadcastSequence: 0,
			lastActivityAt: 1,
		});
	});

	return { operatorId, otherUserId, sessionId };
}

describe("public Convex authorization boundaries", () => {
	it("allows the first account and then locks further signups", async () => {
		const t = convexTest(schema, modules);
		expect(await t.query(api.users.accountState, {})).toEqual({
			hasAccount: false,
			signupAllowed: true,
		});

		await t.run(async (ctx) => {
			await ctx.db.insert("users", {
				email: "operator@echo.example",
				name: "Operator",
			});
		});

		expect(await t.query(api.users.accountState, {})).toEqual({
			hasAccount: true,
			signupAllowed: false,
		});
	});

	it("lets each signed-in account operate only its own sessions", async () => {
		const t = convexTest(schema, modules);
		const { operatorId, otherUserId } = await seedOperator(t);

		const operator = t.withIdentity(identityFor(operatorId));
		const other = t.withIdentity(identityFor(otherUserId));

		expect(await operator.query(api.users.isOperator, {})).toBe(true);
		expect(await other.query(api.users.isOperator, {})).toBe(true);
		expect(await other.query(api.sessions.listMine, {})).toEqual([]);
		expect(
			await other.query(api.sessions.getMineBySlug, {
				slug: "protected-session",
			}),
		).toBeNull();
	});

	it("protects direct mutations even when the session exists", async () => {
		const t = convexTest(schema, modules);
		const { otherUserId, sessionId } = await seedOperator(t);
		const other = t.withIdentity(identityFor(otherUserId));

		await expect(
			other.query(api.segments.transcriptText, { sessionId }),
		).rejects.toThrow();

		await expect(
			other.mutation(api.sessions.updateTitle, {
				sessionId,
				title: "Attacker title",
			}),
		).rejects.toThrow();

		expect(
			await t.run(
				async (ctx) => (await ctx.db.get("sessions", sessionId))?.title,
			),
		).toBe("Protected session");
	});

	it("protects direct actions without an authenticated Operator", async () => {
		const t = convexTest(schema, modules);

		await expect(t.action(api.scribe.getScribeToken, {})).rejects.toThrow();
	});

	it("denies a missing or deleted identity", async () => {
		const t = convexTest(schema, modules);
		const { operatorId } = await seedOperator(t);
		const operator = t.withIdentity(identityFor(operatorId));

		expect(await t.query(api.users.isOperator, {})).toBe(false);
		await t.run((ctx) => ctx.db.delete(operatorId));
		expect(await operator.query(api.users.isOperator, {})).toBe(false);
		expect(await operator.query(api.sessions.listMine, {})).toBeNull();
	});
});
