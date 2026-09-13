import { v } from "convex/values";
import { env, internalQuery, type QueryCtx, query } from "./_generated/server";
import { getCurrentOperatorId } from "./lib/auth";
import { allowSignupFromEnv, isSignupAllowed } from "./lib/signupPolicy";

async function hasStoredAccount(ctx: QueryCtx) {
	return (await ctx.db.query("users").first()) !== null;
}

export const accountState = query({
	args: {},
	returns: v.object({
		hasAccount: v.boolean(),
		signupAllowed: v.boolean(),
	}),
	handler: async (ctx) => {
		const hasAccount = await hasStoredAccount(ctx);
		return {
			hasAccount,
			signupAllowed: isSignupAllowed(
				hasAccount,
				allowSignupFromEnv(env.ALLOW_SIGNUP),
			),
		};
	},
});

export const signupAllowed = internalQuery({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => {
		return isSignupAllowed(
			await hasStoredAccount(ctx),
			allowSignupFromEnv(env.ALLOW_SIGNUP),
		);
	},
});

export const isOperator = query({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => (await getCurrentOperatorId(ctx)) !== null,
});

export const me = query({
	args: {},
	returns: v.union(v.object({ email: v.string() }), v.null()),
	handler: async (ctx) => {
		const userId = await getCurrentOperatorId(ctx);
		if (!userId) return null;
		const user = await ctx.db.get("users", userId);
		if (!user?.email) return null;
		return { email: user.email };
	},
});

export const getCurrentOperator = internalQuery({
	args: {},
	returns: v.union(v.id("users"), v.null()),
	handler: getCurrentOperatorId,
});
