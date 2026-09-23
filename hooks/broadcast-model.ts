import { ConvexError } from "convex/values";
import { Option, Schema } from "effect";
import type { Id } from "@/convex/_generated/dataModel";

const convexFailureDataSchema = Schema.Struct({
	message: Schema.NonEmptyString,
});

export class BroadcastCommandConflict extends Schema.TaggedError<BroadcastCommandConflict>()(
	"BroadcastCommandConflict",
	{ message: Schema.String },
) {}

export class DisconnectTimeout extends Schema.TaggedError<DisconnectTimeout>()(
	"DisconnectTimeout",
	{ message: Schema.String },
) {}

export class BroadcastCommandError extends Schema.TaggedError<BroadcastCommandError>()(
	"BroadcastCommandError",
	{ message: Schema.String },
) {}

export class RealtimeTranscriptionError extends Schema.TaggedError<RealtimeTranscriptionError>()(
	"RealtimeTranscriptionError",
	{ message: Schema.String },
) {}

export type BroadcastCommand = { kind: "start" } | { kind: "stop" };

export type BroadcastCommandResult = {
	kind: BroadcastCommand["kind"];
	broadcastId: Id<"broadcasts">;
};

export function createBroadcastCommandGate() {
	let busy = false;

	return {
		isBusy: () => busy,
		run: async <A>(execute: () => Promise<A>): Promise<A> => {
			if (busy) {
				throw new BroadcastCommandConflict({
					message: "Another Broadcast command is already running",
				});
			}

			busy = true;

			try {
				return await execute();
			} finally {
				busy = false;
			}
		},
	};
}

export function toBroadcastCommandError(
	cause: unknown,
):
	| BroadcastCommandConflict
	| DisconnectTimeout
	| BroadcastCommandError
	| RealtimeTranscriptionError {
	if (
		cause instanceof BroadcastCommandConflict ||
		cause instanceof DisconnectTimeout ||
		cause instanceof BroadcastCommandError ||
		cause instanceof RealtimeTranscriptionError
	) {
		return cause;
	}

	if (cause instanceof ConvexError) {
		return new BroadcastCommandError({
			message: Option.match(
				Schema.decodeUnknownOption(convexFailureDataSchema)(cause.data),
				{
					onNone: () => "Broadcast command failed",
					onSome: ({ message }) => message,
				},
			),
		});
	}

	throw cause;
}

export function ignorePresentedBroadcastError(cause: unknown): void {
	toBroadcastCommandError(cause);
}
