import {
	AudioFormat,
	CommitStrategy,
	type ScribeCallbacks,
	type UseScribeReturn,
} from "@elevenlabs/react";
import { useCallback, useEffect, useRef } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
	type BroadcastCommands,
	useBroadcastAdapters,
} from "@/hooks/broadcast-adapters";
import type { CaptureEvent } from "@/hooks/broadcast-capture";
import {
	DisconnectTimeout,
	RealtimeTranscriptionError,
} from "@/hooks/broadcast-model";
import { classifyMicrophoneError } from "@/hooks/microphone-devices";
import { fromScribeCode } from "@/shared/languages";

const DISCONNECT_TIMEOUT_MS = 2_000;

const CONNECTION_READY_TIMEOUT_MS = 5_000;

type ConnectionReadyWaiter = {
	generation: number;
	resolve: () => void;
	reject: (error: Error) => void;
	timeoutId: number;
};

export type RealtimeScribe = Pick<
	UseScribeReturn,
	| "status"
	| "partialTranscript"
	| "isConnected"
	| "connect"
	| "disconnect"
	| "clearTranscripts"
> & { getConnection: () => { close: () => void } | null };

export type RealtimeScribeHandlers = Required<
	Pick<
		ScribeCallbacks,
		| "onPartialTranscript"
		| "onCommittedTranscriptWithTimestamps"
		| "onError"
		| "onAuthError"
		| "onQuotaExceededError"
		| "onCommitThrottledError"
		| "onTranscriberError"
		| "onUnacceptedTermsError"
		| "onRateLimitedError"
		| "onInputError"
		| "onQueueOverflowError"
		| "onResourceExhaustedError"
		| "onSessionTimeLimitExceededError"
		| "onChunkSizeExceededError"
		| "onInsufficientAudioActivityError"
		| "onConnect"
		| "onSessionStarted"
		| "onDisconnect"
	>
> & { onClosing: () => void };

export type RealtimeCaptureSink = {
	onCommit?: (event: CaptureEvent) => void;
	onError?: (message: string) => void;
};

export function useRealtimeConnection({
	sessionId,
	deviceId,
	onCommit,
	onError,
	getScribeToken,
	scribe,
	registerHandlers,
}: {
	sessionId: Id<"sessions"> | undefined;
	deviceId: string;
	onCommit?: (event: CaptureEvent) => void;
	onError?: (message: string) => void;
	getScribeToken: (args: Record<string, never>) => Promise<{ token: string }>;
	scribe: RealtimeScribe;
	registerHandlers: (handlers: RealtimeScribeHandlers) => () => void;
}) {
	const sessionIdRef = useRef(sessionId);
	const onCommitRef = useRef(onCommit);
	const onErrorRef = useRef(onError);
	const generationRef = useRef(0);
	const activeGenerationRef = useRef<number | null>(null);
	const closingGenerationRef = useRef<number | null>(null);
	const mountedRef = useRef(true);
	const failedGenerationRef = useRef<number | null>(null);
	const connectionReadyWaiterRef = useRef<ConnectionReadyWaiter | null>(null);

	const unsubscribeHandlersRef = useRef<(() => void) | null>(null);

	const releaseHandlers = useCallback(() => {
		unsubscribeHandlersRef.current?.();
		unsubscribeHandlersRef.current = null;
	}, []);

	const disconnectPromiseRef = useRef<Promise<void> | null>(null);

	const disconnectWaiterRef = useRef<{
		resolve: () => void;
		reject: (error: DisconnectTimeout) => void;
		generation: number;
		timeoutId: number;
	} | null>(null);

	sessionIdRef.current = sessionId;
	onCommitRef.current = onCommit;
	onErrorRef.current = onError;

	const createHandlers = (
		generation: number,
		sink: RealtimeCaptureSink,
	): RealtimeScribeHandlers => {
		const reportRealtimeFailure = (message: string) => {
			if (
				generation !== activeGenerationRef.current ||
				failedGenerationRef.current === generation
			)
				return;
			failedGenerationRef.current = generation;
			const failure = new RealtimeTranscriptionError({ message });
			const waiter = connectionReadyWaiterRef.current;

			if (waiter?.generation === generation) {
				connectionReadyWaiterRef.current = null;
				window.clearTimeout(waiter.timeoutId);
				waiter.reject(failure);

				return;
			}

			sink.onError?.(failure.message);
		};

		const signalReady = () => {
			const waiter = connectionReadyWaiterRef.current;

			if (
				!waiter ||
				waiter.generation !== generation ||
				generation !== activeGenerationRef.current
			) {
				return;
			}

			connectionReadyWaiterRef.current = null;
			window.clearTimeout(waiter.timeoutId);
			waiter.resolve();
		};

		return {
			onClosing: () => {
				if (activeGenerationRef.current === generation)
					closingGenerationRef.current = generation;
			},
			onPartialTranscript: () => {},
			onCommittedTranscriptWithTimestamps: (data) => {
				const transcript = data.text.trim();

				if (generation !== activeGenerationRef.current || !transcript) {
					return;
				}

				sink.onCommit?.({
					generation,
					commitId: crypto.randomUUID(),
					sourceText: transcript,
					sourceLanguage: fromScribeCode(data.language_code) ?? "",
					capturedAt: Date.now(),
				});
			},
			onError: () =>
				reportRealtimeFailure(
					"Realtime transcription failed. Stop and start recording again.",
				),
			onAuthError: () =>
				reportRealtimeFailure("Realtime transcription authorization failed."),
			onQuotaExceededError: () =>
				reportRealtimeFailure("Realtime transcription quota was exceeded."),
			onCommitThrottledError: () =>
				reportRealtimeFailure("Realtime transcription is temporarily busy."),
			onTranscriberError: () =>
				reportRealtimeFailure(
					"Realtime transcription failed. Stop and start recording again.",
				),
			onUnacceptedTermsError: () =>
				reportRealtimeFailure(
					"Realtime transcription terms were not accepted.",
				),
			onRateLimitedError: () =>
				reportRealtimeFailure("Realtime transcription is rate limited."),
			onInputError: () =>
				reportRealtimeFailure(
					"Realtime transcription rejected the audio input.",
				),
			onQueueOverflowError: () =>
				reportRealtimeFailure("Realtime transcription audio queue overflowed."),
			onResourceExhaustedError: () =>
				reportRealtimeFailure(
					"Realtime transcription resources are temporarily exhausted.",
				),
			onSessionTimeLimitExceededError: () =>
				reportRealtimeFailure(
					"Realtime transcription reached its session limit.",
				),
			onChunkSizeExceededError: () =>
				reportRealtimeFailure(
					"Realtime transcription rejected an audio frame.",
				),
			onInsufficientAudioActivityError: () =>
				reportRealtimeFailure(
					"Realtime transcription stopped because no speech was detected.",
				),
			onConnect: signalReady,
			onSessionStarted: signalReady,
			onDisconnect: () => {
				if (
					activeGenerationRef.current !== generation &&
					closingGenerationRef.current !== generation
				)
					return;

				const expectedClose = closingGenerationRef.current === generation;

				if (!expectedClose) {
					reportRealtimeFailure(
						"Realtime transcription disconnected unexpectedly. Start recording again.",
					);
				}

				releaseHandlers();
				activeGenerationRef.current = null;
				closingGenerationRef.current = null;
				const readyWaiter = connectionReadyWaiterRef.current;

				if (readyWaiter) {
					connectionReadyWaiterRef.current = null;
					window.clearTimeout(readyWaiter.timeoutId);
					readyWaiter.reject(
						new RealtimeTranscriptionError({
							message: "Realtime transcription disconnected during activation",
						}),
					);
				}

				const waiter = disconnectWaiterRef.current;

				if (!waiter) return;
				disconnectWaiterRef.current = null;
				window.clearTimeout(waiter.timeoutId);
				waiter.resolve();
			},
		};
	};

	const scribeRef = useRef(scribe);
	scribeRef.current = scribe;

	const createHandlersRef = useRef(createHandlers);
	createHandlersRef.current = createHandlers;
	const registerHandlersRef = useRef(registerHandlers);
	registerHandlersRef.current = registerHandlers;

	const disconnect = useCallback((): Promise<void> => {
		if (disconnectPromiseRef.current) return disconnectPromiseRef.current;
		const currentScribe = scribeRef.current;

		if (!currentScribe.getConnection()) {
			releaseHandlers();
			activeGenerationRef.current = null;

			return Promise.resolve();
		}

		const generation = activeGenerationRef.current;

		if (generation === null) {
			closingGenerationRef.current = generationRef.current;
			currentScribe.disconnect();
			currentScribe.clearTranscripts();

			return Promise.resolve();
		}

		const promise = new Promise<void>((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				const waiter = disconnectWaiterRef.current;

				if (!waiter || waiter.generation !== generation) return;
				disconnectWaiterRef.current = null;
				// Keep the native close barrier: its own CLOSE listener mutates the
				// hook's connection reference. Reuse is safe only after that event.

				if (activeGenerationRef.current === generation) {
					activeGenerationRef.current = null;
				}

				reject(
					new DisconnectTimeout({
						message:
							"Timed out waiting for the transcription connection to close",
					}),
				);
			}, DISCONNECT_TIMEOUT_MS);

			disconnectWaiterRef.current = {
				resolve,
				reject,
				generation,
				timeoutId,
			};
		});

		disconnectPromiseRef.current = promise;
		closingGenerationRef.current = generation;
		currentScribe.disconnect();
		currentScribe.clearTranscripts();

		return promise;
	}, [releaseHandlers]);

	const connect = useCallback(
		async (sink?: RealtimeCaptureSink) => {
			const currentScribe = scribeRef.current;

			const captureSink = sink ?? {
				onCommit: onCommitRef.current,
				onError: onErrorRef.current,
			};

			if (!deviceId || !sessionIdRef.current) return false;

			if (
				!mountedRef.current ||
				closingGenerationRef.current !== null ||
				activeGenerationRef.current !== null ||
				currentScribe.getConnection()
			) {
				return false;
			}

			disconnectPromiseRef.current = null;
			const generation = generationRef.current + 1;
			generationRef.current = generation;
			activeGenerationRef.current = generation;
			failedGenerationRef.current = null;

			const readiness = new Promise<void>((resolve, reject) => {
				const timeoutId = window.setTimeout(() => {
					const waiter = connectionReadyWaiterRef.current;

					if (!waiter || waiter.generation !== generation) return;
					connectionReadyWaiterRef.current = null;
					reject(
						new RealtimeTranscriptionError({
							message:
								"Timed out waiting for realtime transcription to connect",
						}),
					);
				}, CONNECTION_READY_TIMEOUT_MS);

				connectionReadyWaiterRef.current = {
					generation,
					resolve,
					reject,
					timeoutId,
				};
			});

			try {
				const { token } = await getScribeToken({});

				if (!mountedRef.current || activeGenerationRef.current !== generation) {
					const waiter = connectionReadyWaiterRef.current;

					if (waiter?.generation === generation) {
						connectionReadyWaiterRef.current = null;
						window.clearTimeout(waiter.timeoutId);
						waiter.resolve();
					}

					return false;
				}

				try {
					currentScribe.clearTranscripts();

					const connected = currentScribe.connect({
						token,
						microphone: {
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true,
							deviceId,
						},
					});

					unsubscribeHandlersRef.current = registerHandlersRef.current(
						createHandlersRef.current(generation, captureSink),
					);
					await connected;
				} catch (cause) {
					const microphoneError = classifyMicrophoneError(cause);
					throw new RealtimeTranscriptionError({
						message: microphoneError.message,
					});
				}

				if (!mountedRef.current || activeGenerationRef.current !== generation) {
					const waiter = connectionReadyWaiterRef.current;

					if (waiter?.generation === generation) {
						connectionReadyWaiterRef.current = null;
						window.clearTimeout(waiter.timeoutId);
						waiter.resolve();
					}

					if (activeGenerationRef.current === generation) {
						activeGenerationRef.current = null;
					}

					closingGenerationRef.current = generation;
					currentScribe.getConnection()?.close();

					return false;
				}

				await readiness;

				return generation;
			} catch (error) {
				const waiter = connectionReadyWaiterRef.current;

				if (waiter?.generation === generation) {
					connectionReadyWaiterRef.current = null;
					window.clearTimeout(waiter.timeoutId);
					waiter.resolve();
				}

				try {
					await disconnect();
				} catch (cleanup) {
					if (!(cleanup instanceof DisconnectTimeout)) throw cleanup;
				}

				throw error;
			}
		},
		[deviceId, getScribeToken, disconnect],
	);

	useEffect(() => {
		mountedRef.current = true;

		return () => {
			mountedRef.current = false;
			const waiter = connectionReadyWaiterRef.current;

			if (waiter) {
				connectionReadyWaiterRef.current = null;
				window.clearTimeout(waiter.timeoutId);
				waiter.resolve();
			}

			void disconnect().catch((cause) => {
				if (!(cause instanceof DisconnectTimeout)) throw cause;

				if (!mountedRef.current) {
					releaseHandlers();
					closingGenerationRef.current = null;
				}
			});
		};
	}, [disconnect, releaseHandlers]);

	return {
		status: scribe.status,
		partialTranscript: scribe.partialTranscript,
		isConnected: scribe.isConnected,
		connect,
		disconnect,
	};
}

export function useLiveRealtimeConnection({
	sessionId,
	deviceId,
	onCommit,
	onError,
	getScribeToken,
}: {
	sessionId: Id<"sessions"> | undefined;
	deviceId: string;
	onCommit?: (event: CaptureEvent) => void;
	onError?: (message: string) => void;
	getScribeToken: BroadcastCommands["getScribeToken"];
}) {
	const { useScribe } = useBroadcastAdapters();

	const scribe = useScribe({
		modelId: "scribe_v2_realtime",
		commitStrategy: CommitStrategy.VAD,
		// SDK rejects <= 0.3 (exclusive); docs claim "between 0.3 and 3.0".
		vadSilenceThresholdSecs: 0.31,
		vadThreshold: 0.3,
		includeTimestamps: true,
		includeLanguageDetection: true,
		audioFormat: AudioFormat.PCM_16000,
		microphone: {
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	});

	return useRealtimeConnection({
		sessionId,
		deviceId,
		onCommit,
		onError,
		getScribeToken,
		scribe,
		registerHandlers: scribe.registerHandlers,
	});
}
