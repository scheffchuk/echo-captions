import { describe, expect, it } from "vitest";
import { toClientAuthState } from "./client";

describe("toClientAuthState", () => {
	it("keeps storage bootstrap in the loading state", () => {
		expect(
			toClientAuthState({ isLoading: true, isAuthenticated: false }),
		).toEqual({ status: "loading" });
	});

	it("projects an authenticated snapshot", () => {
		expect(
			toClientAuthState({ isLoading: false, isAuthenticated: true }),
		).toEqual({ status: "authenticated" });
	});

	it("projects an unauthenticated snapshot", () => {
		expect(
			toClientAuthState({ isLoading: false, isAuthenticated: false }),
		).toEqual({ status: "unauthenticated" });
	});
});
