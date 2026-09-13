import { describe, expect, it } from "vitest";
import { normalizeEmail, parseEmail } from "./email";

describe("email identity", () => {
	it("normalizes caller input before checks", () => {
		expect(normalizeEmail("  Operator@Echo.example ")).toBe(
			"operator@echo.example",
		);
		expect(normalizeEmail(" ")).toBeUndefined();
	});

	it("accepts a plausible email", () => {
		expect(parseEmail("  Operator@Echo.example ")).toBe(
			"operator@echo.example",
		);
	});

	it("rejects missing and malformed addresses", () => {
		expect(() => parseEmail(undefined)).toThrow("Invalid email");
		expect(() => parseEmail("not-an-email")).toThrow("Invalid email");
		expect(() => parseEmail("missing-domain@")).toThrow("Invalid email");
	});
});
