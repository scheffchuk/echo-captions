"use client";

import {
	AudioFormat,
	CommitStrategy,
	type ScribeStatus,
	useScribe,
} from "@elevenlabs/react";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CaptureEvent } from "@/hooks/broadcast-capture";
import {
	DisconnectTimeout,
	RealtimeTranscriptionError,
} from "@/hooks/broadcast-model";
import { classifyMicrophoneError } from "@/hooks/microphone-devices";
import { fromScribeCode } from "@/lib/languages";

export type RealtimeConnectionState = ScribeStatus;

const DISCONNECT_TIMEOUT_MS = 2_000;
const CONNECTION_READY_TIMEOUT_MS = 5_000;

type ConnectionReadyWaiter = {
	generation: number;
	resolve: () => void;
	reject: (error: Error) => void;
	timeoutId: number;
};

export function useRealtimeConnection({
	sessionId,
	deviceId,
	onCommit,
	onError,
}: {
	sessionId: Id<"sessions"> | undefined;
	deviceId: string;
	onCommit?: (event: CaptureEvent) => void;
	onError?: (message: string) => void;
}) {
	const getScribeToken = useAction(api.scribe.getScribeToken);
	const sessionIdRef = useRef(sessionId);
	const onCommitRef = useRef(onCommit);
	const onErrorRef = useRef(onError);
	const generationRef = useRef(0);
	const activeGenerationRef = useRef<number | null>(null);
	const closingGenerationRef = useRef<number | null>(null);
	const mountedRef = useRef(true);
	const failedGenerationRef = useRef<number | null>(null);
	const connectionReadyWaiterRef = useRef<ConnectionReadyWaiter | null>(null);
	const disconnectWaiterRef = useRef<{
		resolve: () => void;
		reject: (error: DisconnectTimeout) => void;
		generation: number;
		timeoutId: number;
	} | null>(null);

	sessionIdRef.current = sessionId;
	onCommitRef.current = onCommit;
	onErrorRef.current = onError;
	const reportRealtimeFailure = useCallback((message: string) => {
		const generation = activeGenerationRef.current;
		if (generation === null || failedGenerationRef.current === generation)
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
		onErrorRef.current?.(failure.message);
	}, []);

	const scribe = useScribe({
		modelId: "scribe_v2_realtime",
		commitStrategy: CommitStrategy.VAD,
		// SDK rejects <= 0.3 (exclusive); docs claim "between 0.3 and 3.0".
		vadSilenceThresholdSecs: 0.31,
		vadThreshold: 0.3,
		includeLanguageDetection: true,
		audioFormat: AudioFormat.PCM_16000,
		microphone: {
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
		onPartialTranscript: () => {},
		onCommittedTranscriptWithTimestamps: (data) => {
			const generation = activeGenerationRef.current;
			const transcript = data.text.trim();
			const activeSessionId = sessionIdRef.current;
			if (generation === null || !activeSessionId || !transcript) {
				return;
			}

			onCommitRef.current?.({
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
			reportRealtimeFailure("Realtime transcription terms were not accepted."),
		onRateLimitedError: () =>
			reportRealtimeFailure("Realtime transcription is rate limited."),
		onInputError: () =>
			reportRealtimeFailure("Realtime transcription rejected the audio input."),
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
			reportRealtimeFailure("Realtime transcription rejected an audio frame."),
		onInsufficientAudioActivityError: () =>
			reportRealtimeFailure(
				"Realtime transcription stopped because no speech was detected.",
			),
		onConnect: () => {
			const waiter = connectionReadyWaiterRef.current;
			if (!waiter || waiter.generation !== activeGenerationRef.current) {
				return;
			}
			connectionReadyWaiterRef.current = null;
			window.clearTimeout(waiter.timeoutId);
			waiter.resolve();
		},
		onSessionStarted: () => {
			const waiter = connectionReadyWaiterRef.current;
			if (!waiter || waiter.generation !== activeGenerationRef.current) {
				return;
			}
			connectionReadyWaiterRef.current = null;
			window.clearTimeout(waiter.timeoutId);
			waiter.resolve();
		},
		onDisconnect: () => {
			const generation = activeGenerationRef.current;
			const expectedClose =
				generation === null || closingGenerationRef.current === generation;
			if (!expectedClose) {
				reportRealtimeFailure(
					"Realtime transcription disconnected unexpectedly. Start recording again.",
				);
			}
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
	});
	const scribeRef = useRef(scribe);
	scribeRef.current = scribe;
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			closingGenerationRef.current = generationRef.current;
			activeGenerationRef.current = null;
			const waiter = connectionReadyWaiterRef.current;
			if (waiter) {
				connectionReadyWaiterRef.current = null;
				window.clearTimeout(waiter.timeoutId);
				waiter.resolve();
			}
			scribeRef.current.getConnection()?.close();
		};
	}, []);

	const connect = useCallback(async () => {
		if (!deviceId || !sessionIdRef.current) return false;
		if (
			!mountedRef.current ||
			closingGenerationRef.current !== null ||
			activeGenerationRef.current !== null ||
			scribe.getConnection()
		) {
			return false;
		}

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
						message: "Timed out waiting for realtime transcription to connect",
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
				await scribe.connect({
					token,
					microphone: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
						deviceId,
					},
				});
			} catch (error) {
				const microphoneError = classifyMicrophoneError(error);
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
				scribe.getConnection()?.close();
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
			if (activeGenerationRef.current === generation) {
				activeGenerationRef.current = null;
			}
			if (scribe.getConnection()) {
				closingGenerationRef.current = generation;
				scribe.disconnect();
				scribe.clearTranscripts();
			}
			throw error;
		}
	}, [deviceId, getScribeToken, scribe]);

	const disconnect = useCallback((): Promise<void> => {
		if (!scribe.getConnection()) {
			activeGenerationRef.current = null;
			return Promise.resolve();
		}

		const generation = activeGenerationRef.current;
		if (generation === null) {
			closingGenerationRef.current = generationRef.current;
			scribe.disconnect();
			scribe.clearTranscripts();
			return Promise.resolve();
		}
		const promise = new Promise<void>((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				const waiter = disconnectWaiterRef.current;
				if (!waiter || waiter.generation !== generation) return;
				disconnectWaiterRef.current = null;
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
		closingGenerationRef.current = generation;
		scribe.disconnect();
		scribe.clearTranscripts();
		return promise;
	}, [scribe]);

	return {
		status: scribe.status,
		partialTranscript: scribe.partialTranscript,
		isConnected: scribe.isConnected,
		connect,
		disconnect,
	};
}
