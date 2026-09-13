import { describe, expect, it } from "vitest";
import { normalizeReturnTo } from "./return-to";

const origin = "https://echo.example";

describe("normalizeReturnTo", () => {
	it("uses the dashboard as the default", () => {
		expect(normalizeReturnTo(undefined, origin)).toBe("/");
		expect(normalizeReturnTo("", origin)).toBe("/");
	});

	it("preserves an internal path, search, and hash", () => {
		expect(
			normalizeReturnTo("/broadcast/demo?mode=live#captions", origin),
		).toBe("/broadcast/demo?mode=live#captions");
	});

	it("reduces a same-origin absolute URL to an internal destination", () => {
		expect(
			normalizeReturnTo(
				"https://echo.example/view/demo?lang=ja#latest",
				origin,
			),
		).toBe("/view/demo?lang=ja#latest");
	});

	it("rejects external, protocol-relative, and malformed destinations", () => {
		expect(normalizeReturnTo("https://evil.example/steal", origin)).toBe("/");
		expect(normalizeReturnTo("//evil.example/steal", origin)).toBe("/");
		expect(normalizeReturnTo("\\\\evil.example\\steal", origin)).toBe("/");
		expect(normalizeReturnTo("not a url", origin)).toBe("/");
	});

	it("does not accept an absolute URL without a trusted origin", () => {
		expect(normalizeReturnTo("https://echo.example/view/demo")).toBe("/");
	});
});
