import { describe, expect, it } from "vitest";
import { allowSignupFromEnv, isSignupAllowed } from "./signupPolicy";

describe("signup policy", () => {
	it("allows the first account even when the env flag is off", () => {
		expect(isSignupAllowed(false, false)).toBe(true);
		expect(isSignupAllowed(false, true)).toBe(true);
	});

	it("gates additional accounts on the env flag", () => {
		expect(isSignupAllowed(true, false)).toBe(false);
		expect(isSignupAllowed(true, true)).toBe(true);
	});

	it("treats only the string true as an open deploy", () => {
		expect(allowSignupFromEnv("true")).toBe(true);
		expect(allowSignupFromEnv(undefined)).toBe(false);
		expect(allowSignupFromEnv("1")).toBe(false);
	});
});
