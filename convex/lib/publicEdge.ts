import { ConvexError } from "convex/values";
import { Schema } from "effect";

const isTaggedPublicError = Schema.is(
	Schema.Struct({ _tag: Schema.String, message: Schema.String }),
);

/** Translate expected tagged errors into public ConvexErrors; rethrow the rest. */
export async function atPublicEdge<A>(
	codes: Readonly<Record<string, string>>,
	operation: () => Promise<A>,
): Promise<A> {
	try {
		return await operation();
	} catch (error) {
		const code = isTaggedPublicError(error)
			? Object.entries(codes).find(([tag]) => tag === error._tag)?.[1]
			: undefined;

		if (isTaggedPublicError(error) && code !== undefined) {
			throw new ConvexError({ code, message: error.message });
		}

		throw error;
	}
}
