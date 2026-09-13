import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import {
	convexAuth,
	createAccount,
	modifyAccountCredentials,
	retrieveAccount,
} from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { parseEmail } from "../shared/email";
import { internal } from "./_generated/api";

function assertPassword(password: unknown): string {
	if (typeof password !== "string" || password.length < 8) {
		throw new Error("Invalid password");
	}
	return password;
}

const password = ConvexCredentials({
	id: "password",
	authorize: async (params, ctx) => {
		const flow = params.flow;
		if (flow !== "signUp" && flow !== "signIn" && flow !== "changePassword") {
			throw new Error("Invalid credentials");
		}

		const email = parseEmail(params.email);
		const passwordValue = assertPassword(params.password);

		if (flow === "signUp") {
			if (!(await ctx.runQuery(internal.users.signupAllowed, {}))) {
				throw new Error("Sign up is disabled");
			}

			const created = await createAccount(ctx, {
				provider: "password",
				account: { id: email, secret: passwordValue },
				profile: { email },
			});
			return { userId: created.user._id };
		}

		const retrieved = await retrieveAccount(ctx, {
			provider: "password",
			account: { id: email, secret: passwordValue },
		});
		if (retrieved === null) {
			throw new Error("Invalid credentials");
		}

		if (flow === "changePassword") {
			const nextPassword = assertPassword(params.newPassword);
			await modifyAccountCredentials(ctx, {
				provider: "password",
				account: { id: email, secret: nextPassword },
			});
		}

		return { userId: retrieved.user._id };
	},
	crypto: {
		async hashSecret(secret: string) {
			return await new Scrypt().hash(secret);
		},
		async verifySecret(secret: string, hash: string) {
			return await new Scrypt().verify(hash, secret);
		},
	},
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [password],
});
