// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getStoredMicDevice } from "@/lib/broadcast-preferences";

const microphoneKey = "echo-broadcast-mic:conference";

describe("broadcast preferences", () => {
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

	it("decodes a valid microphone preference", () => {
		localStorage.setItem(microphoneKey, "microphone-1");

		expect(getStoredMicDevice("conference")).toBe("microphone-1");
	});

	it("removes a malformed optional microphone preference", () => {
		localStorage.setItem(microphoneKey, "");

		expect(getStoredMicDevice("conference")).toBeNull();
		expect(localStorage.getItem(microphoneKey)).toBeNull();
	});
});
