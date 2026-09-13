import { describe, expect, it } from "vitest";
import {
	getDefaultLoginFlow,
	getOperatorAccessState,
	getOperatorAuthErrorMessage,
} from "./operator";

describe("getDefaultLoginFlow", () => {
	it("waits for account state", () => {
		expect(getDefaultLoginFlow(undefined)).toBe("loading");
	});

	it("opens on create when no account exists", () => {
		expect(
			getDefaultLoginFlow({ hasAccount: false, signupAllowed: true }),
		).toBe("signUp");
	});

	it("opens on sign-in once an account exists", () => {
		expect(
			getDefaultLoginFlow({ hasAccount: true, signupAllowed: false }),
		).toBe("signIn");
	});
});

describe("getOperatorAuthErrorMessage", () => {
	it("keeps credential failures user-safe", () => {
		expect(getOperatorAuthErrorMessage(new Error("Invalid credentials"))).toBe(
			"That email or password wasn’t recognized.",
		);
	});

	it("keeps short-password failures specific", () => {
		expect(getOperatorAuthErrorMessage(new Error("Invalid password"))).toBe(
			"Password must be at least 8 characters",
		);
	});

	it("explains a closed signup", () => {
		expect(getOperatorAuthErrorMessage(new Error("Sign up is disabled"))).toBe(
			"New accounts are not allowed on this deployment.",
		);
	});

	it("throws unexpected auth defects", () => {
		const defect = new Error("database exploded");
		expect(() => getOperatorAuthErrorMessage(defect)).toThrow(defect);
	});
});

describe("getOperatorAccessState", () => {
	it("waits for auth and operator checks during hydration", () => {
		expect(getOperatorAccessState({ status: "loading" }, undefined)).toBe(
			"loading",
		);
		expect(getOperatorAccessState({ status: "authenticated" }, undefined)).toBe(
			"loading",
		);
	});

	it("authorizes only an authenticated account", () => {
		expect(getOperatorAccessState({ status: "authenticated" }, true)).toBe(
			"authorized",
		);
		expect(getOperatorAccessState({ status: "authenticated" }, false)).toBe(
			"unauthorized",
		);
	});

	it("keeps signed-out navigation separate from denied identities", () => {
		expect(getOperatorAccessState({ status: "unauthenticated" }, false)).toBe(
			"unauthenticated",
		);
	});
});
