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
	cause: unknown,
	fallbackMessage: string,
): { code: string | undefined; message: string } {
	if (!(cause instanceof ConvexError)) throw cause;

	return Option.match(
		Schema.decodeUnknownOption(publicErrorDataSchema)(cause.data),
		{
			onNone: () => ({ code: undefined, message: fallbackMessage }),
			onSome: (data) =>
				Schema.is(Schema.String)(data)
					? { code: undefined, message: data }
					: { code: data.code, message: data.message },
		},
	);
}

export function getClipboardErrorMessage(
	cause: unknown,
	fallbackMessage: string,
): string {
	const decoded = Option.getOrUndefined(
		Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }))(cause),
	);

	if (
		decoded?.name === "NotAllowedError" ||
		decoded?.name === "SecurityError" ||
		decoded?.name === "NotFoundError"
	) {
		return fallbackMessage;
	}

	throw cause;
}
