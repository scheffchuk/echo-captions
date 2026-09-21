import { getAuthUserId } from "@convex-dev/auth/server";
import { Schema } from "effect";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

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

export async function requireOperatorId(ctx: AuthCtx): Promise<Id<"users">> {
	const operatorId =
		"db" in ctx
			? await getCurrentOperatorId(ctx)
			: await ctx.runQuery(internal.users.getCurrentOperator, {});
	if (operatorId === null) {
		throw new NotAuthenticated({ message: "Not authenticated" });
	}
	return operatorId;
}
