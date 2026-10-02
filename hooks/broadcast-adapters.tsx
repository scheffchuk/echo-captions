import {
	RealtimeEvents,
	type ScribeHookOptions,
	useScribe,
} from "@elevenlabs/react";
import { useAction, useMutation } from "convex/react";
import { createContext, type ReactNode, useContext, useRef } from "react";
import { api } from "@/convex/_generated/api";
import type {
	RealtimeScribe,
	RealtimeScribeHandlers,
} from "@/hooks/use-realtime-connection";

type NativeCommands = ReturnType<typeof useNativeCommands>;

export type BroadcastCommands = {
	[Command in keyof NativeCommands]: (
		...args: Parameters<NativeCommands[Command]>
	) => ReturnType<NativeCommands[Command]>;
};

function useNativeCommands() {
	const start = useMutation(api.broadcasts.start);
	const resume = useMutation(api.broadcasts.resume);
	const stop = useMutation(api.broadcasts.stop);
	const abandon = useMutation(api.broadcasts.abandon);
	const heartbeat = useMutation(api.broadcasts.heartbeat);
	const acceptCommit = useMutation(api.captions.acceptCommit);
	const getScribeToken = useAction(api.scribe.getScribeToken);

	return {
		start,
		resume,
		stop,
		abandon,
		heartbeat,
		acceptCommit,
		getScribeToken,
	};
}

function useNativeScribe(options: ScribeHookOptions) {
	const scribe = useScribe(options);

	return {
		...scribe,
		registerHandlers: (handlers: RealtimeScribeHandlers) => {
			const connection = scribe.getConnection();

			if (!connection) return () => {};

			let closed = false;
			let audioCleanup = connection._audioCleanup;
			// Scribe installs this cleanup after async microphone setup. Departure can
			// precede that assignment, so release hardware as soon as it arrives.
			Object.defineProperty(connection, "_audioCleanup", {
				get: () => audioCleanup,
				set: (cleanup: typeof connection._audioCleanup) => {
					audioCleanup = cleanup;

					if (closed) {
						audioCleanup?.();
						audioCleanup = undefined;
					}
				},
			});
			const close = connection.close.bind(connection);
			connection.close = () => {
				if (closed) return;
				closed = true;
				handlers.onClosing();
				close();
			};

			const cleanups: (() => void)[] = [];

			const listen: typeof connection.on = (event, listener) => {
				connection.on(event, listener);
				cleanups.push(() => connection.off(event, listener));
			};

			// Bind to this connection so late events cannot reach a new generation.
			listen(RealtimeEvents.OPEN, handlers.onConnect);
			listen(RealtimeEvents.SESSION_STARTED, handlers.onSessionStarted);
			listen(RealtimeEvents.CLOSE, handlers.onDisconnect);
			listen(
				RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS,
				handlers.onCommittedTranscriptWithTimestamps,
			);
			listen(RealtimeEvents.ERROR, () =>
				handlers.onError(new Error("Realtime transcription failed")),
			);
			listen(RealtimeEvents.AUTH_ERROR, handlers.onAuthError);
			listen(RealtimeEvents.QUOTA_EXCEEDED, handlers.onQuotaExceededError);
			listen(RealtimeEvents.COMMIT_THROTTLED, handlers.onCommitThrottledError);
			listen(RealtimeEvents.TRANSCRIBER_ERROR, handlers.onTranscriberError);
			listen(RealtimeEvents.UNACCEPTED_TERMS, handlers.onUnacceptedTermsError);
			listen(RealtimeEvents.RATE_LIMITED, handlers.onRateLimitedError);
			listen(RealtimeEvents.INPUT_ERROR, handlers.onInputError);
			listen(RealtimeEvents.QUEUE_OVERFLOW, handlers.onQueueOverflowError);
			listen(
				RealtimeEvents.RESOURCE_EXHAUSTED,
				handlers.onResourceExhaustedError,
			);
			listen(
				RealtimeEvents.SESSION_TIME_LIMIT_EXCEEDED,
				handlers.onSessionTimeLimitExceededError,
			);
			listen(
				RealtimeEvents.CHUNK_SIZE_EXCEEDED,
				handlers.onChunkSizeExceededError,
			);
			listen(
				RealtimeEvents.INSUFFICIENT_AUDIO_ACTIVITY,
				handlers.onInsufficientAudioActivityError,
			);

			return () => {
				for (const cleanup of cleanups) cleanup();
			};
		},
	};
}

const nativeAdapters = {
	useCommands: useNativeCommands,
	useScribe: useNativeScribe,
};

type BroadcastAdapters = {
	useCommands: () => BroadcastCommands;
	useScribe: (options: ScribeHookOptions) => RealtimeScribe & {
		registerHandlers: (handlers: RealtimeScribeHandlers) => () => void;
	};
};

const BroadcastAdaptersContext =
	createContext<BroadcastAdapters>(nativeAdapters);

/** Internal transport seam; each mounted tree keeps the same hook adapters. */
export function BroadcastAdaptersProvider({
	adapters,
	children,
}: {
	adapters: BroadcastAdapters;
	children: ReactNode;
}) {
	const initial = useRef(adapters);

	if (initial.current !== adapters)
		throw new Error(
			"Broadcast hook adapters cannot change within a mounted tree",
		);

	return (
		<BroadcastAdaptersContext.Provider value={adapters}>
			{children}
		</BroadcastAdaptersContext.Provider>
	);
}

export function useBroadcastAdapters() {
	return useContext(BroadcastAdaptersContext);
}
