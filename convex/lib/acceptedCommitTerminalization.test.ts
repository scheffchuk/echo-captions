import { describe, expect, it } from "vitest";
import { testId } from "../../test/ids";
import { assertTargetCompletion } from "./acceptedCommitTerminalization";

const targetId = testId("acceptedCommitTargets", "target-1");

const target = { _id: targetId, targetLanguage: "ja" };

describe("accepted commit target completion contract", () => {
	it("accepts translated and failed completions for the same target", () => {
		expect(() =>
			assertTargetCompletion(target, {
				kind: "translated",
				targetId,
				targetLanguage: "ja",
				translation: "こんにちは",
			}),
		).not.toThrow();
		expect(() =>
			assertTargetCompletion(target, {
				kind: "failed",
				targetId,
				targetLanguage: "ja",
				error: "Provider rejected the request",
			}),
		).not.toThrow();
	});

	it("rejects impossible completion identities and malformed terminal values", () => {
		expect(() =>
			assertTargetCompletion(target, {
				kind: "translated",
				targetId: testId("acceptedCommitTargets", "other-target"),
				targetLanguage: "ja",
				translation: "こんにちは",
			}),
		).toThrow("Translation completion identity mismatch");
		expect(() =>
			assertTargetCompletion(target, {
				kind: "translated",
				targetId,
				targetLanguage: "ja",
				translation: "",
			}),
		).toThrow("Translated completion has no translation");
		expect(() =>
			assertTargetCompletion(target, {
				kind: "failed",
				targetId,
				targetLanguage: "ja",
				error: " ",
			}),
		).toThrow("Failed completion has no error classification");
	});
});
