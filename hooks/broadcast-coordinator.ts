import { Effect, Queue, Stream } from "effect";
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
import type { OperatorCommitProjection } from "@/lib/operator-commit-feed";

export type BroadcastLifecycleStatus =
	| "active"
	| "lost"
	| "stopping"
	| "sealed";

export type BroadcastActivation = {
	broadcastId: string;
	sequence: number;
	lastCommitOrdinal: number;
};

export type BroadcastCommitInput = {
	sessionId: string;
	broadcastId: string;
	commitOrdinal: number;
	commitId: string;
	sourceText: string;
	sourceLanguage: string;
};

export type BroadcastCoordinatorAdapters = {
	connect: () => Promise<number | false>;
	disconnect: () => Promise<void>;
	start: (sessionId: string) => Promise<BroadcastActivation>;
	resume: (broadcastId: string) => Promise<BroadcastActivation>;
	heartbeat: (broadcastId: string) => Promise<void>;
	stop: (args: { broadcastId: string }) => Promise<{
		lastCommitOrdinal: number;
	}>;
	acceptCommit: (args: BroadcastCommitInput) => Promise<unknown>;
};

export type BroadcastCoordinatorTimers = {
	setInterval: (
		handler: () => void,
		timeout: number,
	) => ReturnType<typeof setInterval>;
	clearInterval: (id: ReturnType<typeof setInterval>) => void;
};

export type BroadcastCoordinatorSnapshot = {
	activeBroadcastId: string | null;
	optimisticCaptures: readonly OperatorCommitProjection[];
	rejectedCaptures: readonly RejectedCapture[];
	commandResult: {
		waiting: boolean;
		error: unknown | null;
	};
};

export type BroadcastCoordinator = ReturnType<
	typeof createBroadcastCoordinator
>;

type CoordinatorLifecycle =
	| { tag: "idle" }
	| { tag: "starting" }
	| { tag: "active"; activation: BroadcastActivation }
	| { tag: "stopping"; activation: BroadcastActivation }
	| { tag: "sealed"; lastCommitOrdinal: number };

const HEARTBEAT_INTERVAL_MS = 5_000;

const defaultTimers: BroadcastCoordinatorTimers = {
	setInterval: (handler, timeout) => globalThis.setInterval(handler, timeout),
	clearInterval: (id) => globalThis.clearInterval(id),
};

const rejectedBySession = new Map<string, readonly RejectedCapture[]>();

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

function emptySnapshot(): BroadcastCoordinatorSnapshot {
	return {
		activeBroadcastId: null,
		optimisticCaptures: [],
		rejectedCaptures: [],
		commandResult: { waiting: false, error: null },
	};
}

function initialLifecycle(): CoordinatorLifecycle {
	return { tag: "idle" };
}

export function createBroadcastCoordinator({
	onSnapshot,
	onError,
	timers = defaultTimers,
}: {
	onSnapshot?: (snapshot: BroadcastCoordinatorSnapshot) => void;
	onError?: (message: string) => void;
	timers?: BroadcastCoordinatorTimers;
} = {}) {
	let adapters: BroadcastCoordinatorAdapters | null = null;
	let sessionId: string | undefined;
	let recoverableBroadcastId: string | null | undefined;
	let reportError = onError;
	let disposed = false;
	let lifecycle = initialLifecycle();
	let realtimeFailed = false;
	let lastAcceptedOrdinal = 0;
	let captureBuffer: CaptureBuffer = createCaptureBuffer();
	let captureDrainPromise: Promise<void> | null = null;
	let pagehideRequested = false;
	let pendingEventCount = 0;
	let eventDrainWaiters: Array<() => void> = [];
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let heartbeatFailureReported = false;
	let commandWaiting = false;
	let commandError: unknown | null = null;
	let interruptEventFiber: (() => void) | null = null;
	let snapshot = emptySnapshot();

	const commandGate = createBroadcastCommandGate();
	const eventQueue = Effect.runSync(Queue.unbounded<CaptureEvent>());

	const getActiveActivation = () =>
		lifecycle.tag === "active" || lifecycle.tag === "stopping"
			? lifecycle.activation
			: null;
	const getActiveBroadcastId = () => getActiveActivation()?.broadcastId ?? null;

	const emit = () => {
		snapshot = {
			activeBroadcastId: getActiveBroadcastId(),
			optimisticCaptures: snapshot.optimisticCaptures,
			rejectedCaptures: sessionId
				? (rejectedBySession.get(sessionId) ?? [])
				: [],
			commandResult: {
				waiting: commandWaiting,
				error: commandError,
			},
		};
		onSnapshot?.(snapshot);
	};

	const updateHeartbeat = () => {
		const activeBroadcastId = getActiveBroadcastId();
		const shouldHeartbeat =
			!disposed && lifecycle.tag === "active" && activeBroadcastId !== null;
		if (!shouldHeartbeat && heartbeatTimer !== null) {
			timers.clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (shouldHeartbeat && heartbeatTimer === null) {
			heartbeatFailureReported = false;
			heartbeatTimer = timers.setInterval(() => {
				const activeBroadcastId =
					lifecycle.tag === "active" ? lifecycle.activation.broadcastId : null;
				const currentAdapters = adapters;
				if (!activeBroadcastId || !currentAdapters) return;
				void currentAdapters.heartbeat(activeBroadcastId).catch((error) => {
					const failure = toBroadcastCommandError(error);
					if (heartbeatFailureReported) return;
					heartbeatFailureReported = true;
					reportError?.(failure.message);
				});
			}, HEARTBEAT_INTERVAL_MS);
		}
	};

	const update = (input: {
		sessionId?: string;
		recoverableBroadcastId?: string | null;
		broadcastStatus?: BroadcastLifecycleStatus;
		adapters?: BroadcastCoordinatorAdapters;
		onError?: (message: string) => void;
	}) => {
		if ("sessionId" in input) sessionId = input.sessionId;
		if ("recoverableBroadcastId" in input) {
			recoverableBroadcastId = input.recoverableBroadcastId;
		}
		if (input.adapters) adapters = input.adapters;
		if ("onError" in input) reportError = input.onError;
		updateHeartbeat();
		emit();
	};

	const setOptimisticCapture = (capture: CapturedCommit) => {
		if (
			snapshot.optimisticCaptures.some(
				(item) => item.commitId === capture.commitId,
			)
		) {
			return;
		}
		snapshot = {
			...snapshot,
			optimisticCaptures: [
				...snapshot.optimisticCaptures,
				{
					commitId: capture.commitId,
					broadcastSequence: getActiveActivation()?.sequence,
					commitOrdinal: capture.commitOrdinal,
					sourceText: capture.sourceText,
					sourceLanguage: capture.sourceLanguage,
					translations: {},
					status: "pending",
				},
			],
		};
		emit();
	};

	const clearOptimisticCapture = (commitId: string) => {
		const optimisticCaptures = snapshot.optimisticCaptures.filter(
			(capture) => capture.commitId !== commitId,
		);
		if (optimisticCaptures.length === snapshot.optimisticCaptures.length)
			return;
		snapshot = { ...snapshot, optimisticCaptures };
		emit();
	};

	const markRejected = (
		captures: readonly CapturedCommit[],
		reason: string,
	) => {
		if (!sessionId || captures.length === 0) return;
		const previous = rejectedBySession.get(sessionId) ?? [];
		const existingIds = new Set(previous.map((capture) => capture.commitId));
		const additions = captures.filter(
			(capture) => !existingIds.has(capture.commitId),
		);
		if (additions.length === 0) return;
		rejectedBySession.set(sessionId, [
			...previous,
			...additions.map((capture) => toRejectedCapture(capture, reason)),
		]);
		emit();
	};

	const clearRejectedCapture = (commitId: string) => {
		if (!sessionId) return;
		const previous = rejectedBySession.get(sessionId);
		if (!previous) return;
		const remaining = previous.filter(
			(capture) => capture.commitId !== commitId,
		);
		if (remaining.length === previous.length) return;
		if (remaining.length === 0) rejectedBySession.delete(sessionId);
		else rejectedBySession.set(sessionId, remaining);
		emit();
	};

	const clearRejectedCaptures = () => {
		if (!sessionId || !rejectedBySession.has(sessionId)) return;
		rejectedBySession.delete(sessionId);
		emit();
	};

	const appendCaptureEvent = (event: CaptureEvent) => {
		if (event.generation > captureBuffer.generation) {
			captureBuffer = {
				...captureBuffer,
				generation: event.generation,
			};
		}
		const appended = appendCapture(captureBuffer, event);
		captureBuffer = appended.buffer;
		return appended.capture;
	};

	const drainCaptures = (): Promise<void> => {
		if (captureDrainPromise) return captureDrainPromise;

		const promise = (async () => {
			while (!disposed && captureBuffer.pending.length > 0) {
				const capture = captureBuffer.pending[0];
				const activeBroadcastId = getActiveBroadcastId();
				const activeSessionId = sessionId;
				const currentAdapters = adapters;
				if (
					!capture ||
					!activeBroadcastId ||
					!activeSessionId ||
					!currentAdapters
				) {
					return;
				}

				setOptimisticCapture(capture);
				try {
					await Effect.runPromise(
						acceptCaptionCommit(() =>
							currentAdapters.acceptCommit({
								sessionId: activeSessionId,
								broadcastId: activeBroadcastId,
								commitOrdinal: capture.commitOrdinal,
								commitId: capture.commitId,
								sourceText: capture.sourceText,
								sourceLanguage: capture.sourceLanguage,
							}),
						),
					);
					lastAcceptedOrdinal = Math.max(
						lastAcceptedOrdinal,
						capture.commitOrdinal,
					);
					captureBuffer = removeCapture(captureBuffer, capture.commitId);
					clearRejectedCapture(capture.commitId);
				} catch (error) {
					clearOptimisticCapture(capture.commitId);
					captureBuffer = rebaseCaptures(
						removeCapture(captureBuffer, capture.commitId),
						lastAcceptedOrdinal,
					);
					markRejected(
						[capture],
						`Could not accept caption: ${commandMessage(error)}`,
					);
					reportError?.(
						"A caption could not be accepted. It remains available for export.",
					);
				}
			}
		})();

		captureDrainPromise = promise;
		const releaseDrain = () => {
			if (captureDrainPromise === promise) captureDrainPromise = null;
		};
		void promise.then(releaseDrain, releaseDrain);
		return promise;
	};

	const processCapture = async (event: CaptureEvent) => {
		if (disposed) return;
		const capture = appendCaptureEvent(event);
		if (capture && getActiveBroadcastId()) await drainCaptures();
	};

	const resolveEventDrainWaiters = () => {
		if (pendingEventCount !== 0) return;
		const waiters = eventDrainWaiters;
		eventDrainWaiters = [];
		for (const resolve of waiters) resolve();
	};

	const waitForCaptureEvents = () => {
		if (pendingEventCount === 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			eventDrainWaiters.push(resolve);
		});
	};

	const rejectPendingCaptures = (reason: string) => {
		if (captureBuffer.pending.length > 0) {
			markRejected(captureBuffer.pending, reason);
		}
		captureBuffer = {
			...captureBuffer,
			broadcastId: null,
			pending: [],
		};
		emit();
	};

	const drainQueuedCaptures = () => {
		const queued = Effect.runSync(Queue.clear(eventQueue));
		for (const event of queued) appendCaptureEvent(event);
		pendingEventCount = Math.max(0, pendingEventCount - queued.length);
		resolveEventDrainWaiters();
	};

	const clearActiveBroadcast = (lastCommitOrdinal?: number) => {
		lifecycle =
			lastCommitOrdinal === undefined
				? { tag: "idle" }
				: { tag: "sealed", lastCommitOrdinal };
		pagehideRequested = false;
		if (lastCommitOrdinal !== undefined) {
			lastAcceptedOrdinal = lastCommitOrdinal;
		}
		captureBuffer = { ...captureBuffer, broadcastId: null };
		updateHeartbeat();
		emit();
	};

	const getAdapters = () => {
		if (!adapters) {
			throw new BroadcastCommandError({ message: "Broadcast is not ready" });
		}
		return adapters;
	};

	const startEffect = Effect.fn("BroadcastCoordinator.start")(function* () {
		const activeSessionId = sessionId;
		if (!activeSessionId) {
			return yield* new BroadcastCommandError({
				message: "Session is not loaded",
			});
		}
		const currentAdapters = yield* Effect.sync(getAdapters);
		lifecycle = { tag: "starting" };
		emit();
		pagehideRequested = false;
		realtimeFailed = false;

		const generation = yield* Effect.tryPromise({
			try: () => currentAdapters.connect(),
			catch: toBroadcastCommandError,
		});
		if (generation === false) {
			return yield* new BroadcastCommandError({
				message: "Realtime transcription could not connect",
			});
		}
		captureBuffer = { ...captureBuffer, generation };
		if (realtimeFailed) {
			return yield* new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}

		const recoverableId = recoverableBroadcastId;
		const activation = recoverableId
			? yield* Effect.tryPromise({
					try: () => currentAdapters.resume(recoverableId),
					catch: toBroadcastCommandError,
				})
			: yield* Effect.tryPromise({
					try: () => currentAdapters.start(activeSessionId),
					catch: toBroadcastCommandError,
				});
		lifecycle = { tag: "active", activation };
		lastAcceptedOrdinal = activation.lastCommitOrdinal;
		captureBuffer = activateCaptureBuffer(
			captureBuffer,
			activation.broadcastId,
			activation.lastCommitOrdinal,
		);
		updateHeartbeat();
		emit();

		if (realtimeFailed) {
			yield* Effect.tryPromise({
				try: () =>
					currentAdapters.stop({ broadcastId: activation.broadcastId }),
				catch: toBroadcastCommandError,
			});
			clearActiveBroadcast();
			return yield* new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}

		yield* Effect.promise(drainCaptures);
		if (realtimeFailed) {
			yield* Effect.tryPromise({
				try: () =>
					currentAdapters.stop({ broadcastId: activation.broadcastId }),
				catch: toBroadcastCommandError,
			});
			clearActiveBroadcast();
			return yield* new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}
		if (pagehideRequested) {
			pagehideRequested = false;
			yield* stopEffect();
		}
		return { kind: "start" as const, broadcastId: activation.broadcastId };
	});

	const stopEffect = Effect.fn("BroadcastCoordinator.stop")(function* () {
		const activeActivation = getActiveActivation();
		if (!activeActivation) {
			return yield* new BroadcastCommandError({
				message: "Broadcast is not active",
			});
		}
		const activeBroadcastId = activeActivation.broadcastId;
		const currentAdapters = yield* Effect.sync(getAdapters);
		lifecycle = { tag: "stopping", activation: activeActivation };
		updateHeartbeat();
		emit();
		yield* Effect.tryPromise({
			try: () => currentAdapters.disconnect(),
			catch: toBroadcastCommandError,
		});
		yield* Effect.promise(waitForCaptureEvents);
		yield* Effect.promise(drainCaptures);
		const stopped = yield* Effect.tryPromise({
			try: () => currentAdapters.stop({ broadcastId: activeBroadcastId }),
			catch: toBroadcastCommandError,
		});
		clearActiveBroadcast(stopped.lastCommitOrdinal);
		return { kind: "stop" as const, broadcastId: activeBroadcastId };
	});

	const run = async (
		command: BroadcastCommand,
	): Promise<BroadcastCommandResult> => {
		try {
			return await commandGate.run(async () => {
				commandWaiting = true;
				commandError = null;
				emit();
				try {
					if (command.kind === "start") {
						return await Effect.runPromise(startEffect());
					}
					return await Effect.runPromise(stopEffect());
				} catch (error) {
					if (command.kind === "start") {
						pagehideRequested = false;
						await getAdapters().disconnect().catch(ignoreDisconnectTimeout);
						const activeBroadcastId = getActiveBroadcastId();
						if (activeBroadcastId) {
							await getAdapters()
								.stop({ broadcastId: activeBroadcastId })
								.catch(ignorePresentedBroadcastError);
						}
						clearActiveBroadcast();
						const failure = toBroadcastCommandError(error);
						rejectPendingCaptures(
							`Broadcast activation failed: ${failure.message}`,
						);
						throw failure;
					}
					throw error;
				} finally {
					commandWaiting = false;
					emit();
				}
			});
		} catch (error) {
			const failure = toBroadcastCommandError(error);
			commandError = failure;
			emit();
			reportError?.(failure.message);
			throw failure;
		}
	};

	const handleRealtimeError = (message: string) => {
		realtimeFailed = true;
		if (commandGate.isBusy()) return;
		reportError?.(message);
		if (!getActiveBroadcastId()) return;
		void run({ kind: "stop" }).catch(ignorePresentedBroadcastError);
	};

	const handlePagehide = () => {
		pagehideRequested = true;
		if (commandGate.isBusy()) return;
		if (!getActiveBroadcastId()) {
			void adapters?.disconnect().catch(ignoreDisconnectTimeout);
			return;
		}
		void run({ kind: "stop" }).catch(ignorePresentedBroadcastError);
	};

	const abandon = () => {
		rejectPendingCaptures("Broadcast tail was explicitly abandoned");
		void adapters?.disconnect().catch((error) => {
			if (error instanceof DisconnectTimeout) {
				reportError?.(error.message);
				return;
			}
			throw error;
		});
		clearActiveBroadcast();
	};

	const offerCapture = (event: CaptureEvent) => {
		if (disposed) return;
		ensureEventFiber();
		pendingEventCount += 1;
		Queue.offerUnsafe(eventQueue, event);
	};

	const ensureEventFiber = () => {
		if (interruptEventFiber || disposed) return;
		const fiber = Effect.runFork(
			Stream.fromQueue(eventQueue).pipe(
				Stream.runForEach((event) =>
					Effect.promise(() =>
						processCapture(event).finally(() => {
							pendingEventCount = Math.max(0, pendingEventCount - 1);
							resolveEventDrainWaiters();
						}),
					),
				),
			),
		);
		interruptEventFiber = () => fiber.interruptUnsafe();
	};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (heartbeatTimer !== null) {
			timers.clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		drainQueuedCaptures();
		rejectPendingCaptures("Broadcast scope was unmounted before acceptance");
		eventDrainWaiters = [];
		interruptEventFiber?.();
		interruptEventFiber = null;
		void adapters?.disconnect().catch(ignoreDisconnectTimeout);
	};

	return {
		update,
		run,
		offerCapture,
		handleRealtimeError,
		handlePagehide,
		abandon,
		dispose,
		clearRejectedCaptures,
		snapshot: () => snapshot,
	};
}
