import { ConvexError } from "convex/values";
import { Effect, Option, Schema } from "effect";

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
	broadcastId: string;
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
	error: unknown,
):
	| BroadcastCommandConflict
	| DisconnectTimeout
	| BroadcastCommandError
	| RealtimeTranscriptionError {
	if (
		error instanceof BroadcastCommandConflict ||
		error instanceof DisconnectTimeout ||
		error instanceof BroadcastCommandError ||
		error instanceof RealtimeTranscriptionError
	) {
		return error;
	}
	if (error instanceof ConvexError) {
		return new BroadcastCommandError({
			message: Option.match(
				Schema.decodeUnknownOption(convexFailureDataSchema)(error.data),
				{
					onNone: () => "Broadcast command failed",
					onSome: ({ message }) => message,
				},
			),
		});
	}
	throw error;
}

export const acceptCaptionCommit = Effect.fn("Broadcast.acceptCaptionCommit")(
	function* <A>(accept: () => Promise<A>) {
		return yield* Effect.tryPromise({
			try: accept,
			catch: toBroadcastCommandError,
		});
	},
);

export function ignorePresentedBroadcastError(error: unknown): void {
	toBroadcastCommandError(error);
}
