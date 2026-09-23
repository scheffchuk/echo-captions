import { Schema } from "effect";

const taggedPublicError = Schema.Struct({
	_tag: Schema.String,
	message: Schema.String,
});

export const isTaggedPublicError = Schema.is(taggedPublicError);

export function publicErrorCode(
	codes: Readonly<Record<string, string>>,
	tag: string,
): string | undefined {
	for (const [key, code] of Object.entries(codes)) {
		if (key === tag) return code;
	}

	return undefined;
}
