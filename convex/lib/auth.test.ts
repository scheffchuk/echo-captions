// @vitest-environment edge-runtime

import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireCurrentOperatorId } from "./auth";

const operatorId = "users:operator" as Id<"users">;
const sessionId = "authSessions:session";

function makeContext(args: {
	identityUserId?: Id<"users">;
	user?: Doc<"users"> | null;
}): QueryCtx {
	return {
		auth: {
			getUserIdentity: async () =>
				args.identityUserId === undefined
					? null
					: {
							issuer: "https://auth.example",
							subject: `${args.identityUserId}|${sessionId}`,
							tokenIdentifier: `https://auth.example|${args.identityUserId}|${sessionId}`,
						},
		},
		db: {
			get: async (_table: string, id: string) =>
				id === args.identityUserId ? (args.user ?? null) : null,
		},
	} as unknown as QueryCtx;
}

function storedUser(userId: Id<"users">): Doc<"users"> {
	return {
		_id: userId,
		_creationTime: 0,
		email: "operator@echo.example",
	} as Doc<"users">;
}

describe("requireCurrentOperatorId", () => {
	it("denies an unauthenticated caller", async () => {
		await expect(
			requireCurrentOperatorId(makeContext({})),
		).rejects.toMatchObject({ _tag: "NotAuthenticated" });
	});

	it("denies a deleted account", async () => {
		await expect(
			requireCurrentOperatorId(
				makeContext({
					identityUserId: operatorId,
					user: null,
				}),
			),
		).rejects.toMatchObject({ _tag: "NotAuthenticated" });
	});

	it("returns the signed-in user id", async () => {
		await expect(
			requireCurrentOperatorId(
				makeContext({
					identityUserId: operatorId,
					user: storedUser(operatorId),
				}),
			),
		).resolves.toBe(operatorId);
	});
});
