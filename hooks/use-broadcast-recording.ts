"use client";

import { useAtom } from "@effect/atom-react";
import { useMutation } from "convex/react";
import { Effect, Queue, Stream } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
	activateCaptureBuffer,
	appendCapture,
	type CaptureBuffer,
	type CapturedCommit,
	type CaptureEvent,
	createCaptureBuffer,
	type RejectedCapture,
	rebaseCaptures,
	removeCapture,
	toRejectedCapture,
} from "@/hooks/broadcast-capture";
import {
	acceptCaptionCommit,
	type BroadcastCommand,
	BroadcastCommandConflict,
	BroadcastCommandError,
	type BroadcastCommandResult,
	createBroadcastCommandGate,
	DisconnectTimeout,
	ignorePresentedBroadcastError,
	RealtimeTranscriptionError,
	toBroadcastCommandError,
} from "@/hooks/broadcast-model";
import { useRealtimeConnection } from "@/hooks/use-realtime-connection";
import type { OperatorCommitProjection } from "@/lib/operator-commit-feed";

export type BroadcastVoiceState = "idle" | "connecting" | "recording";
export type BroadcastLifecycleStatus =
	| "active"
	| "lost"
	| "stopping"
	| "sealed";

const rejectedCapturesAtom = Atom.keepAlive(
	Atom.make<ReadonlyMap<string, readonly RejectedCapture[]>>(new Map()),
);

function commandMessage(error: unknown) {
	if (error instanceof DisconnectTimeout) return error.message;
	if (error instanceof BroadcastCommandConflict) return error.message;
	if (error instanceof BroadcastCommandError) return error.message;
	if (error instanceof RealtimeTranscriptionError) return error.message;
	throw error;
}

function ignoreDisconnectTimeout(error: unknown): void {
	if (error instanceof DisconnectTimeout) return;
	throw error;
}

export function useBroadcastRecording({
	sessionId,
	deviceId,
	broadcastStatus,
	recoverableBroadcastId,
	onError,
}: {
	sessionId: Id<"sessions"> | undefined;
	deviceId: string;
	broadcastStatus?: BroadcastLifecycleStatus;
	recoverableBroadcastId?: Id<"broadcasts"> | null;
	onError?: (message: string) => void;
}) {
	const startBroadcast = useMutation(api.broadcasts.start);
	const resumeBroadcast = useMutation(api.broadcasts.resume);
	const heartbeat = useMutation(api.broadcasts.heartbeat);
	const stopBroadcast = useMutation(api.broadcasts.stop);
	const acceptCommit = useMutation(api.captions.acceptCommit);

	const sessionIdRef = useRef(sessionId);
	const startBroadcastRef = useRef(startBroadcast);
	const resumeBroadcastRef = useRef(resumeBroadcast);
	const heartbeatRef = useRef(heartbeat);
	const stopBroadcastRef = useRef(stopBroadcast);
	const acceptCommitRef = useRef(acceptCommit);
	const recoverableBroadcastIdRef = useRef(recoverableBroadcastId);
	const onErrorRef = useRef(onError);
	const disposedRef = useRef(false);
	const broadcastIdRef = useRef<Id<"broadcasts"> | null>(null);
	const broadcastSequenceRef = useRef<number | null>(null);
	const realtimeErrorRef = useRef<(message: string) => void>(() => {});
	const realtimeFailedRef = useRef(false);
	const lastAcceptedOrdinalRef = useRef(0);
	const captureBufferRef = useRef<CaptureBuffer>(createCaptureBuffer());
	const captureDrainPromiseRef = useRef<Promise<void> | null>(null);
	const pagehideRequestedRef = useRef(false);
	const stopCommandRef = useRef<() => Promise<BroadcastCommandResult>>(
		async () => {
			throw new BroadcastCommandError({ message: "Broadcast is not ready" });
		},
	);
	const executeCommandRef = useRef<
		(command: BroadcastCommand) => Promise<BroadcastCommandResult>
	>(async () => {
		throw new BroadcastCommandError({ message: "Broadcast is not ready" });
	});
	const processCaptureRef = useRef<(event: CaptureEvent) => Promise<void>>(
		async () => {},
	);

	const [eventQueue] = useState(() =>
		Effect.runSync(Queue.unbounded<CaptureEvent>()),
	);
	const pendingEventCountRef = useRef(0);
	const eventDrainWaitersRef = useRef<Array<() => void>>([]);
	const [activeBroadcastId, setActiveBroadcastId] =
		useState<Id<"broadcasts"> | null>(null);
	const [optimisticCaptures, setOptimisticCaptures] = useState<
		readonly OperatorCommitProjection[]
	>([]);
	const [rejectedBySession, setRejectedBySession] =
		useAtom(rejectedCapturesAtom);
	const rejectedCaptures = sessionId
		? (rejectedBySession.get(sessionId) ?? [])
		: [];
	const clearRejectedCaptures = useCallback(() => {
		if (!sessionId) return;
		setRejectedBySession((current) => {
			if (!current.has(sessionId)) return current;
			const next = new Map(current);
			next.delete(sessionId);
			return next;
		});
	}, [sessionId, setRejectedBySession]);

	sessionIdRef.current = sessionId;
	startBroadcastRef.current = startBroadcast;
	resumeBroadcastRef.current = resumeBroadcast;
	heartbeatRef.current = heartbeat;
	stopBroadcastRef.current = stopBroadcast;
	acceptCommitRef.current = acceptCommit;
	recoverableBroadcastIdRef.current = recoverableBroadcastId;
	onErrorRef.current = onError;

	const markRejected = useCallback(
		(captures: readonly CapturedCommit[], reason: string) => {
			if (!sessionId || captures.length === 0) return;
			setRejectedBySession((current) => {
				const previous = current.get(sessionId) ?? [];
				const existingIds = new Set(
					previous.map((capture) => capture.commitId),
				);
				const additions = captures.filter(
					(capture) => !existingIds.has(capture.commitId),
				);
				if (additions.length === 0) return current;
				const next = new Map(current);
				next.set(sessionId, [
					...previous,
					...additions.map((capture) => toRejectedCapture(capture, reason)),
				]);
				return next;
			});
		},
		[sessionId, setRejectedBySession],
	);

	const clearRejectedCapture = useCallback(
		(commitId: string) => {
			if (!sessionId) return;
			setRejectedBySession((current) => {
				const previous = current.get(sessionId);
				if (!previous?.some((capture) => capture.commitId === commitId)) {
					return current;
				}
				const next = new Map(current);
				const remaining = previous.filter(
					(capture) => capture.commitId !== commitId,
				);
				if (remaining.length === 0) next.delete(sessionId);
				else next.set(sessionId, remaining);
				return next;
			});
		},
		[sessionId, setRejectedBySession],
	);

	const clearOptimistic = useCallback((commitId: string) => {
		setOptimisticCaptures((current) =>
			current.filter((capture) => capture.commitId !== commitId),
		);
	}, []);

	const appendCaptureEvent = useCallback((event: CaptureEvent) => {
		const currentBuffer = captureBufferRef.current;
		if (event.generation > currentBuffer.generation) {
			captureBufferRef.current = {
				...currentBuffer,
				generation: event.generation,
			};
		}

		const appended = appendCapture(captureBufferRef.current, event);
		captureBufferRef.current = appended.buffer;
		return appended.capture;
	}, []);

	const drainCaptures = useCallback((): Promise<void> => {
		if (captureDrainPromiseRef.current) {
			return captureDrainPromiseRef.current;
		}

		const promise = (async () => {
			while (
				!disposedRef.current &&
				captureBufferRef.current.pending.length > 0
			) {
				const capture = captureBufferRef.current.pending[0];
				const activeBroadcastId = broadcastIdRef.current;
				const activeSessionId = sessionIdRef.current;
				if (!capture || !activeBroadcastId || !activeSessionId) return;

				setOptimisticCaptures((current) =>
					current.some((item) => item.commitId === capture.commitId)
						? current
						: [
								...current,
								{
									commitId: capture.commitId,
									broadcastSequence: broadcastSequenceRef.current ?? undefined,
									commitOrdinal: capture.commitOrdinal,
									sourceText: capture.sourceText,
									sourceLanguage: capture.sourceLanguage,
									translations: {},
									status: "pending",
								},
							],
				);

				try {
					const payload = {
						sessionId: activeSessionId,
						broadcastId: activeBroadcastId,
						commitOrdinal: capture.commitOrdinal,
						commitId: capture.commitId,
						sourceText: capture.sourceText,
						sourceLanguage: capture.sourceLanguage,
					};
					await Effect.runPromise(
						acceptCaptionCommit(() => acceptCommitRef.current(payload)),
					);
					lastAcceptedOrdinalRef.current = Math.max(
						lastAcceptedOrdinalRef.current,
						capture.commitOrdinal,
					);
					captureBufferRef.current = removeCapture(
						captureBufferRef.current,
						capture.commitId,
					);
					clearRejectedCapture(capture.commitId);
				} catch (error) {
					clearOptimistic(capture.commitId);
					captureBufferRef.current = rebaseCaptures(
						removeCapture(captureBufferRef.current, capture.commitId),
						lastAcceptedOrdinalRef.current,
					);
					markRejected(
						[capture],
						`Could not accept caption: ${commandMessage(error)}`,
					);
					onErrorRef.current?.(
						"A caption could not be accepted. It remains available for export.",
					);
				}
			}
		})();

		captureDrainPromiseRef.current = promise;
		const releaseDrain = () => {
			if (captureDrainPromiseRef.current === promise) {
				captureDrainPromiseRef.current = null;
			}
		};
		void promise.then(releaseDrain, releaseDrain);
		return promise;
	}, [clearOptimistic, clearRejectedCapture, markRejected]);

	const processCapture = useCallback(
		async (event: CaptureEvent) => {
			if (disposedRef.current) return;
			const capture = appendCaptureEvent(event);
			if (capture && broadcastIdRef.current) {
				await drainCaptures();
			}
		},
		[appendCaptureEvent, drainCaptures],
	);
	processCaptureRef.current = processCapture;

	const offerCapture = useCallback(
		(event: CaptureEvent) => {
			if (disposedRef.current) return;
			pendingEventCountRef.current += 1;
			if (!Queue.offerUnsafe(eventQueue, event)) {
				pendingEventCountRef.current -= 1;
			}
		},
		[eventQueue],
	);

	const realtime = useRealtimeConnection({
		sessionId,
		deviceId,
		onCommit: offerCapture,
		onError: (message) => realtimeErrorRef.current(message),
	});

	const connectRef = useRef(realtime.connect);
	const disconnectRef = useRef(realtime.disconnect);
	connectRef.current = realtime.connect;
	disconnectRef.current = realtime.disconnect;

	const waitForCaptureEvents = useCallback(() => {
		if (pendingEventCountRef.current === 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			eventDrainWaitersRef.current.push(resolve);
		});
	}, []);

	const rejectPendingCaptures = useCallback(
		(reason: string) => {
			const pending = captureBufferRef.current.pending;
			if (pending.length > 0) markRejected(pending, reason);
			captureBufferRef.current = {
				...captureBufferRef.current,
				broadcastId: null,
				pending: [],
			};
		},
		[markRejected],
	);
	const teardownCapturesRef = useRef<(reason: string) => void>(() => {});
	const teardownCaptures = useCallback(
		(reason: string) => {
			const queued = Effect.runSync(Queue.takeAll(eventQueue));
			for (const event of queued) appendCaptureEvent(event);
			pendingEventCountRef.current = Math.max(
				0,
				pendingEventCountRef.current - queued.length,
			);
			rejectPendingCaptures(reason);
		},
		[appendCaptureEvent, eventQueue, rejectPendingCaptures],
	);
	teardownCapturesRef.current = teardownCaptures;

	const startCommand =
		useCallback(async (): Promise<BroadcastCommandResult> => {
			const activeSessionId = sessionIdRef.current;
			if (!activeSessionId) {
				throw new BroadcastCommandError({ message: "Session is not loaded" });
			}
			pagehideRequestedRef.current = false;
			realtimeFailedRef.current = false;

			const generation = await connectRef.current();
			if (generation === false) {
				throw new BroadcastCommandError({
					message: "Realtime transcription could not connect",
				});
			}
			captureBufferRef.current = {
				...captureBufferRef.current,
				generation,
			};
			if (realtimeFailedRef.current) {
				throw new BroadcastCommandError({
					message: "Realtime transcription failed during activation",
				});
			}

			try {
				const recoverableId = recoverableBroadcastIdRef.current;
				const broadcast = recoverableId
					? await resumeBroadcastRef.current({ broadcastId: recoverableId })
					: await startBroadcastRef.current({ sessionId: activeSessionId });
				broadcastIdRef.current = broadcast.broadcastId;
				broadcastSequenceRef.current = broadcast.sequence;
				lastAcceptedOrdinalRef.current = broadcast.lastCommitOrdinal;
				captureBufferRef.current = activateCaptureBuffer(
					captureBufferRef.current,
					broadcast.broadcastId,
					broadcast.lastCommitOrdinal,
				);
				setActiveBroadcastId(broadcast.broadcastId);
				if (realtimeFailedRef.current) {
					await stopBroadcastRef.current({
						broadcastId: broadcast.broadcastId,
					});
					broadcastIdRef.current = null;
					broadcastSequenceRef.current = null;
					setActiveBroadcastId(null);
					throw new BroadcastCommandError({
						message: "Realtime transcription failed during activation",
					});
				}
				await drainCaptures();
				if (pagehideRequestedRef.current) {
					pagehideRequestedRef.current = false;
					await stopCommandRef.current();
				}
				return {
					kind: "start",
					broadcastId: broadcast.broadcastId,
				};
			} catch (error) {
				pagehideRequestedRef.current = false;
				await disconnectRef.current().catch(ignoreDisconnectTimeout);
				const failure = toBroadcastCommandError(error);
				rejectPendingCaptures(
					`Broadcast activation failed: ${failure.message}`,
				);
				throw failure;
			}
		}, [drainCaptures, rejectPendingCaptures]);

	const stopCommand = useCallback(async (): Promise<BroadcastCommandResult> => {
		const activeBroadcastId = broadcastIdRef.current;
		if (!activeBroadcastId) {
			throw new BroadcastCommandError({ message: "Broadcast is not active" });
		}

		await disconnectRef.current();
		await waitForCaptureEvents();
		await drainCaptures();
		const stopped = await stopBroadcastRef.current({
			broadcastId: activeBroadcastId,
		});
		broadcastIdRef.current = null;
		broadcastSequenceRef.current = null;
		pagehideRequestedRef.current = false;
		lastAcceptedOrdinalRef.current = stopped.lastCommitOrdinal;
		captureBufferRef.current = {
			...captureBufferRef.current,
			broadcastId: null,
		};
		setActiveBroadcastId(null);
		return {
			kind: "stop",
			broadcastId: activeBroadcastId,
		};
	}, [drainCaptures, waitForCaptureEvents]);
	stopCommandRef.current = stopCommand;

	executeCommandRef.current = async (command) => {
		if (command.kind === "start") return await startCommand();
		return await stopCommand();
	};

	const commandAtom = useMemo(
		() =>
			Atom.fn<BroadcastCommand>()((command) =>
				Effect.tryPromise({
					try: () => executeCommandRef.current(command),
					catch: toBroadcastCommandError,
				}),
			),
		[],
	);
	const [commandResult, writeCommand] = useAtom(commandAtom, {
		mode: "promise",
	});
	const commandGateRef = useRef(createBroadcastCommandGate());

	const dispatchCommand = useCallback(
		async (command: BroadcastCommand) => {
			try {
				return await commandGateRef.current.run(() => writeCommand(command));
			} catch (error) {
				const failure = toBroadcastCommandError(error);
				onErrorRef.current?.(failure.message);
				throw failure;
			}
		},
		[writeCommand],
	);
	realtimeErrorRef.current = (message) => {
		realtimeFailedRef.current = true;
		if (commandGateRef.current.isBusy()) return;
		onErrorRef.current?.(message);
		if (!broadcastIdRef.current) return;
		void dispatchCommand({ kind: "stop" }).catch(ignorePresentedBroadcastError);
	};

	const isConnected = realtime.isConnected;
	const voiceState: BroadcastVoiceState =
		realtime.status === "connecting" || commandResult.waiting
			? "connecting"
			: isConnected
				? "recording"
				: "idle";

	const toggleRecording = useCallback(() => {
		const shouldStart = broadcastStatus === "lost";
		const shouldStop =
			!shouldStart && (isConnected || broadcastIdRef.current !== null);
		return dispatchCommand({ kind: shouldStop ? "stop" : "start" });
	}, [broadcastStatus, dispatchCommand, isConnected]);

	const abandonRecording = useCallback(() => {
		rejectPendingCaptures("Broadcast tail was explicitly abandoned");
		void disconnectRef.current().catch((error) => {
			if (error instanceof DisconnectTimeout) {
				onErrorRef.current?.(error.message);
				return;
			}
			throw error;
		});
		broadcastIdRef.current = null;
		broadcastSequenceRef.current = null;
		setActiveBroadcastId(null);
	}, [rejectPendingCaptures]);

	useEffect(() => {
		if (!activeBroadcastId || broadcastStatus !== "active") return;
		let failureReported = false;
		const interval = window.setInterval(() => {
			void heartbeatRef
				.current({ broadcastId: activeBroadcastId })
				.catch((error) => {
					const failure = toBroadcastCommandError(error);
					if (failureReported) return;
					failureReported = true;
					onErrorRef.current?.(failure.message);
				});
		}, 5_000);
		return () => window.clearInterval(interval);
	}, [activeBroadcastId, broadcastStatus]);

	useEffect(() => {
		disposedRef.current = false;
		const fiber = Effect.runFork(
			Stream.fromQueue(eventQueue).pipe(
				Stream.runForEach((event) =>
					Effect.promise(() =>
						processCaptureRef.current(event).finally(() => {
							pendingEventCountRef.current = Math.max(
								0,
								pendingEventCountRef.current - 1,
							);
							if (pendingEventCountRef.current === 0) {
								const waiters = eventDrainWaitersRef.current.splice(0);
								for (const resolve of waiters) resolve();
							}
						}),
					),
				),
			),
		);
		return () => {
			disposedRef.current = true;
			fiber.interruptUnsafe();
		};
	}, [eventQueue]);

	useEffect(() => {
		const onPageHide = () => {
			pagehideRequestedRef.current = true;
			if (!broadcastIdRef.current || commandGateRef.current.isBusy()) {
				void disconnectRef.current().catch(ignoreDisconnectTimeout);
				return;
			}
			void dispatchCommand({ kind: "stop" }).catch(
				ignorePresentedBroadcastError,
			);
		};
		window.addEventListener("pagehide", onPageHide);
		return () => window.removeEventListener("pagehide", onPageHide);
	}, [dispatchCommand]);

	useEffect(() => {
		return () => {
			disposedRef.current = true;
			teardownCapturesRef.current(
				"Broadcast component was unmounted before acceptance",
			);
			void disconnectRef.current().catch(ignoreDisconnectTimeout);
		};
	}, []);

	return {
		isConnected,
		voiceState,
		partialText: realtime.partialTranscript,
		toggleRecording,
		abandonRecording,
		commandResult,
		optimisticCaptures,
		rejectedCaptures,
		clearRejectedCaptures,
	};
}
