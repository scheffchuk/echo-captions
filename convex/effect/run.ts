import { Effect } from "effect";

export const runConvex = <A>(
	effect: Effect.Effect<A, never, never>,
): Promise<A> => Effect.runPromise(effect);
