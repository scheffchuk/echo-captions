import { ConvexError } from "convex/values";
import { Option, Schema } from "effect";

const publicErrorDataSchema = Schema.Union([
	Schema.NonEmptyString,
	Schema.Struct({
		code: Schema.String,
		message: Schema.NonEmptyString,
	}),
]);

export function getPublicConvexError(
	error: unknown,
	fallbackMessage: string,
): { code: string | undefined; message: string } {
	if (!(error instanceof ConvexError)) throw error;
	return Option.match(
		Schema.decodeUnknownOption(publicErrorDataSchema)(error.data),
		{
			onNone: () => ({ code: undefined, message: fallbackMessage }),
			onSome: (data) =>
				typeof data === "string"
					? { code: undefined, message: data }
					: { code: data.code, message: data.message },
		},
	);
}

export function getClipboardErrorMessage(
	error: unknown,
	fallbackMessage: string,
): string {
	const decoded = Option.getOrUndefined(
		Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }))(error),
	);
	if (
		decoded?.name === "NotAllowedError" ||
		decoded?.name === "SecurityError" ||
		decoded?.name === "NotFoundError"
	) {
		return fallbackMessage;
	}
	throw error;
}
