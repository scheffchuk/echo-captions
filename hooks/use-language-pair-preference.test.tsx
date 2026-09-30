// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLanguagePairPreference } from "@/hooks/use-language-pair-preference";

describe("useLanguagePairPreference", () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
				removeItem: (key: string) => values.delete(key),
			},
		});
	});

	it("uses the saved pair and falls back when the audience changes", () => {
		localStorage.setItem(
			"echo-viewer-langs:event",
			JSON.stringify(["ja", "en"]),
		);

		const { result, rerender } = renderHook(
			({ languages }) =>
				useLanguagePairPreference("event", languages, "viewer"),
			{ initialProps: { languages: ["ja", "en"] } },
		);

		expect(result.current.languagePair).toEqual(["ja", "en"]);

		act(() => result.current.changeLanguagePair(["en"]));
		expect(result.current.languagePair).toEqual(["en"]);

		rerender({ languages: ["fr"] });
		expect(result.current.languagePair).toEqual(["fr"]);
		expect(localStorage.getItem("echo-viewer-langs:event")).toBeNull();
	});

	it("does not carry an operator selection into another session", () => {
		const { result, rerender } = renderHook(
			({ slug }) => useLanguagePairPreference(slug, ["en", "ja"], "operator"),
			{ initialProps: { slug: "first" } },
		);

		act(() => result.current.changeLanguagePair(["ja"]));
		expect(result.current.languagePair).toEqual(["ja"]);

		rerender({ slug: "second" });
		expect(result.current.languagePair).toEqual(["en", "ja"]);
	});
});
