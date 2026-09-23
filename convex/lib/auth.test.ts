/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { NotAuthenticated, requireCurrentOperatorId } from "./auth";

const modules = Object.fromEntries(
	Object.entries(import.meta.glob("../**/*.ts")).map(([key, loader]) => [
		key.replace(/^\.\.\//, "./"),
		loader,
	]),
);

function identityFor(userId: string) {
	return {
		issuer: "https://auth.example",
		subject: `${userId}|authSessions:session`,
		tokenIdentifier: `https://auth.example|${userId}|authSessions:session`,
	};
}

describe("requireCurrentOperatorId", () => {
	it("denies an unauthenticated caller", async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.run((ctx) => requireCurrentOperatorId(ctx)),
		).rejects.toBeInstanceOf(NotAuthenticated);
	});

	it("denies a deleted account", async () => {
		const t = convexTest(schema, modules);

		const userId = await t.run(async (ctx) => {
			const id = await ctx.db.insert("users", {
				email: "gone@echo.example",
				name: "Gone",
			});

			await ctx.db.delete(id);

			return id;
		});

		await expect(
			t
				.withIdentity(identityFor(userId))
				.run((ctx) => requireCurrentOperatorId(ctx)),
		).rejects.toBeInstanceOf(NotAuthenticated);
	});

	it("returns the signed-in user id", async () => {
		const t = convexTest(schema, modules);

		const operatorId = await t.run(async (ctx) => {
			return await ctx.db.insert("users", {
				email: "operator@echo.example",
				name: "Operator",
			});
		});

		await expect(
			t
				.withIdentity(identityFor(operatorId))
				.run((ctx) => requireCurrentOperatorId(ctx)),
		).resolves.toBe(operatorId);
	});
});
