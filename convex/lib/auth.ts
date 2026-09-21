import { getAuthUserId } from "@convex-dev/auth/server";
import { Effect, Schema } from "effect";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { fromConvex, type PersistenceError } from "../effect/convex";

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;

export class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()(
	"NotAuthenticated",
	{ message: Schema.String },
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
	"Unauthorized",
	{ message: Schema.String },
) {}

export const authErrorCodes = {
	NotAuthenticated: "not_authenticated",
	Unauthorized: "unauthorized",
} as const;

export const requireUserId = Effect.fn("Auth.requireUserId")(function* (
	ctx: AuthCtx,
) {
	const userId = yield* fromConvex(
		() => getAuthUserId(ctx),
		"Auth.getAuthUserId",
	);
	if (!userId) {
		return yield* new NotAuthenticated({ message: "Not authenticated" });
	}
	return userId;
});

export const getOperator = Effect.fn("Auth.getOperator")(function* (
	ctx: QueryCtx | MutationCtx,
) {
	const operatorId = yield* fromConvex(
		() => getCurrentOperatorId(ctx),
		"Auth.getOperator",
	);
	if (operatorId === null) {
		return yield* new NotAuthenticated({ message: "Not authenticated" });
	}
	return operatorId;
});

export async function getCurrentOperatorId(
	ctx: QueryCtx | MutationCtx,
): Promise<Id<"users"> | null> {
	const userId = await getAuthUserId(ctx);
	if (!userId) return null;

	const user = await ctx.db.get("users", userId);
	return user ? userId : null;
}

export async function requireCurrentOperatorId(
	ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
	const operatorId = await getCurrentOperatorId(ctx);
	if (operatorId === null) {
		throw new NotAuthenticated({ message: "Not authenticated" });
	}
	return operatorId;
}

export const requireOperatorId = Effect.fn("Auth.requireOperatorId")(function* (
	ctx: AuthCtx,
): Effect.fn.Return<Id<"users">, NotAuthenticated | PersistenceError> {
	const operatorId: Id<"users"> | null = yield* fromConvex(async () => {
		if ("db" in ctx) {
			return await getCurrentOperatorId(ctx);
		}

		return await ctx.runQuery(internal.users.getCurrentOperator, {});
	}, "Auth.requireOperatorId");
	if (operatorId === null) {
		return yield* new NotAuthenticated({ message: "Not authenticated" });
	}
	return operatorId;
});
