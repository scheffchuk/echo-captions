import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type ClientAuthState, useClientAuth } from "./client";

export type LoginFlow = "signIn" | "signUp";

export type AccountState = {
	hasAccount: boolean;
	signupAllowed: boolean;
};

export type OperatorAccessState =
	| "loading"
	| "authorized"
	| "unauthenticated"
	| "unauthorized";

export function getDefaultLoginFlow(
	state: AccountState | undefined,
): LoginFlow | "loading" {
	if (state === undefined) return "loading";
	return state.hasAccount ? "signIn" : "signUp";
}

export function getOperatorAccessState(
	auth: Pick<ClientAuthState, "status">,
	isOperator: boolean | undefined,
): OperatorAccessState {
	if (auth.status === "loading") return "loading";
	if (auth.status === "unauthenticated") return "unauthenticated";
	if (isOperator === undefined) return "loading";
	return isOperator ? "authorized" : "unauthorized";
}

export function getOperatorAuthErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) throw error;
	const message = error.message.toLowerCase();
	if (message.includes("sign up is disabled")) {
		return "New accounts are not allowed on this deployment.";
	}
	if (message.includes("email")) {
		return "Enter a valid email.";
	}
	if (
		message.includes("8 characters") ||
		message.includes("invalid password")
	) {
		return "Password must be at least 8 characters";
	}
	if (message.includes("credential")) {
		return "That email or password wasn’t recognized.";
	}
	throw error;
}

export function useOperatorAuth() {
	const navigate = useNavigate();
	const auth = useClientAuth();
	const accountState = useQuery(api.users.accountState);
	const isOperator = useQuery(api.users.isOperator);
	const me = useQuery(api.users.me);
	const defaultFlow = getDefaultLoginFlow(accountState);

	const signInWithPassword = async (args: {
		email: string;
		password: string;
		flow: LoginFlow;
	}) => {
		if (accountState === undefined) {
			throw new Error("Account state is still loading");
		}

		await auth.signIn("password", {
			email: args.email,
			password: args.password,
			flow: args.flow,
		});
	};

	const changePassword = async (args: {
		currentPassword: string;
		newPassword: string;
	}) => {
		if (!me?.email) {
			throw new Error("Not authenticated");
		}

		await auth.signIn("password", {
			email: me.email,
			password: args.currentPassword,
			newPassword: args.newPassword,
			flow: "changePassword",
		});
	};

	const signOut = async () => {
		await auth.signOut();
		await navigate({ to: "/login", replace: true });
	};

	return {
		status: auth.status,
		isOperator,
		accountState,
		defaultFlow,
		canSignUp: accountState?.signupAllowed === true,
		signInWithPassword,
		changePassword,
		signOut,
	};
}
