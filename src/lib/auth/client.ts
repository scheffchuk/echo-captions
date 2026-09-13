import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";

export type ClientAuthState =
	| { status: "loading" }
	| { status: "authenticated" }
	| { status: "unauthenticated" };

export function toClientAuthState(snapshot: {
	isAuthenticated: boolean;
	isLoading: boolean;
}): ClientAuthState {
	if (snapshot.isLoading) {
		return { status: "loading" };
	}

	return snapshot.isAuthenticated
		? { status: "authenticated" }
		: { status: "unauthenticated" };
}

export function useClientAuth() {
	const snapshot = useConvexAuth();
	const actions = useAuthActions();

	return {
		...toClientAuthState(snapshot),
		signIn: actions.signIn,
		signOut: actions.signOut,
	};
}
