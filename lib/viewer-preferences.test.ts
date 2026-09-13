// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	getStoredLanguagePair,
	getStoredTextSize,
	resolveLanguagePair,
	resolveViewerLanguagePair,
} from "@/lib/viewer-preferences";

const languagePairKey = "echo-viewer-langs:conference";
const textSizeKey = "echo-viewer-text-size";

describe("viewer preferences", () => {
	beforeAll(() => {
		const values = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				clear: () => values.clear(),
				getItem: (key: string) => values.get(key) ?? null,
				removeItem: (key: string) => values.delete(key),
				setItem: (key: string, value: string) => values.set(key, value),
			},
		});
	});

	beforeEach(() => localStorage.clear());

	it("decodes valid language and text-size preferences", () => {
		localStorage.setItem(languagePairKey, JSON.stringify(["ja", "en"]));
		localStorage.setItem(textSizeKey, "1.2");

		expect(getStoredLanguagePair("conference")).toEqual(["ja", "en"]);
		expect(getStoredTextSize()).toBe(1.2);
	});

	it.each([
		"",
		"not-json",
		JSON.stringify([]),
		JSON.stringify(["ja", "ja"]),
		JSON.stringify(["ja", 42]),
	])("removes a malformed optional language preference: %s", (stored) => {
		localStorage.setItem(languagePairKey, stored);

		expect(getStoredLanguagePair("conference")).toBeNull();
		expect(localStorage.getItem(languagePairKey)).toBeNull();
	});

	it.each([
		resolveLanguagePair,
		resolveViewerLanguagePair,
	])("removes a stored pair that is no longer offered", (resolve) => {
		localStorage.setItem(languagePairKey, JSON.stringify(["ja", "en"]));

		resolve("conference", ["de"]);

		expect(localStorage.getItem(languagePairKey)).toBeNull();
	});

	it.each([
		"not-a-number",
		"Infinity",
		"0.7",
		"1.5",
	])("removes a malformed optional text-size preference: %s", (stored) => {
		localStorage.setItem(textSizeKey, stored);

		expect(getStoredTextSize()).toBe(1);
		expect(localStorage.getItem(textSizeKey)).toBeNull();
	});
});
