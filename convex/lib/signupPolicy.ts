export function isSignupAllowed(
	hasAccount: boolean,
	allowSignup: boolean,
): boolean {
	return !hasAccount || allowSignup;
}

export function allowSignupFromEnv(value: string | undefined): boolean {
	return value === "true";
}
