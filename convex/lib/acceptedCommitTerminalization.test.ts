import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
	classifyTargetCompletion,
	MAX_PROVIDER_ATTEMPTS,
	type TargetCompletion,
} from "./acceptedCommitTerminalization";

const targetId = "target-1" as Id<"acceptedCommitTargets">;

const target = {
	_id: targetId,
	targetLanguage: "ja",
	priority: "live" as const,
	providerAttemptCount: 1,
};

describe("accepted commit target terminalization policy", () => {
	it("accepts a translated target as terminal", () => {
		const completion: TargetCompletion = {
			kind: "translated",
			targetId,
			targetLanguage: "ja",
			translation: "こんにちは",
		};

		expect(classifyTargetCompletion(target, completion)).toEqual({
			kind: "terminal",
			status: "translated",
			translation: "こんにちは",
		});
	});

	it("preserves provider failures on the target while terminalizing them", () => {
		const completion: TargetCompletion = {
			kind: "failed",
			targetId,
			targetLanguage: "ja",
			error: "Provider rejected the request",
		};

		expect(classifyTargetCompletion(target, completion)).toEqual({
			kind: "terminal",
			status: "failed",
			error: "Provider rejected the request",
		});
	});

	it("reschedules deferred provider work until the attempt budget is exhausted", () => {
		const completion: TargetCompletion = {
			kind: "deferred",
			targetId,
			targetLanguage: "ja",
			retryAfterMillis: 2_000,
		};

		expect(classifyTargetCompletion(target, completion)).toEqual({
			kind: "retry",
			providerAttemptCount: 2,
			retryAfterMillis: 2_000,
		});

		expect(
			classifyTargetCompletion(
				{ ...target, providerAttemptCount: MAX_PROVIDER_ATTEMPTS - 1 },
				completion,
			),
		).toEqual({
			kind: "terminal",
			status: "failed",
			error: "Translation retries exhausted",
		});
	});

	it("only allows delay-free deferrals for explicit retries", () => {
		const completion: TargetCompletion = {
			kind: "deferred",
			targetId,
			targetLanguage: "ja",
		};

		expect(
			classifyTargetCompletion({ ...target, priority: "retry" }, completion),
		).toEqual({ kind: "defer" });
		expect(() => classifyTargetCompletion(target, completion)).toThrow(
			"Live translation target cannot be deferred",
		);
	});

	it("rejects impossible completion identities and malformed terminal values", () => {
		expect(() =>
			classifyTargetCompletion(target, {
				kind: "translated",
				targetId: "other-target" as Id<"acceptedCommitTargets">,
				targetLanguage: "ja",
				translation: "こんにちは",
			}),
		).toThrow("Translation completion identity mismatch");
		expect(() =>
			classifyTargetCompletion(target, {
				kind: "translated",
				targetId,
				targetLanguage: "ja",
				translation: "",
			}),
		).toThrow("Translated completion has no translation");
	});
});
