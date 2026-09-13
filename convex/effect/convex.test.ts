import { ConvexError } from "convex/values";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { exhaustPublicErrors, PersistenceError } from "./convex";
import { runConvex } from "./run";

class ExpectedError extends Schema.TaggedError<ExpectedError>()(
	"ExpectedError",
	{ message: Schema.String },
) {}

const missingPublicErrorCode = Effect.fail(
	new ExpectedError({ message: "Missing mapping" }),
).pipe(
	// @ts-expect-error Public typed errors require a stable transport code.
	exhaustPublicErrors({}),
);
void missingPublicErrorCode;

describe("Convex Effect boundary", () => {
	it("converts expected failures to stable ConvexError data", async () => {
		const result = runConvex(
			Effect.fail(new ExpectedError({ message: "Safe message" })).pipe(
				exhaustPublicErrors({ ExpectedError: "expected_error" }),
			),
		);

		await expect(result).rejects.toMatchObject({
			data: { code: "expected_error", message: "Safe message" },
		});
		await expect(result).rejects.toBeInstanceOf(ConvexError);
	});

	it("leaves persistence failures as ordinary server failures", async () => {
		const failure = new PersistenceError({
			operation: "Test.read",
			message: "Test.read failed",
			cause: new Error("database unavailable"),
		});
		const result = runConvex(
			Effect.fail(failure).pipe(
				exhaustPublicErrors({ ExpectedError: "expected_error" }),
			),
		);

		await expect(result).rejects.toBe(failure);
	});
});
