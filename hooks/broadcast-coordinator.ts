import type { Id } from "@/convex/_generated/dataModel";
import {
	activateCaptureBuffer,
	appendCapture,
	type CaptureBuffer,
	type CapturedCommit,
	type CaptureEvent,
	createCaptureBuffer,
	createRejectedCaptureOwner,
	type RejectedCapture,
	type RejectedCaptureOwner,
	rebaseCaptures,
	removeCapture,
} from "@/hooks/broadcast-capture";
import {
	type BroadcastCommand,
	BroadcastCommandError,
	type BroadcastCommandResult,
	createBroadcastCommandGate,
	DisconnectTimeout,
	ignorePresentedBroadcastError,
	toBroadcastCommandError,
} from "@/hooks/broadcast-model";
import type { OperatorCommitProjection } from "@/lib/operator-commit-feed";

export type BroadcastLifecycleStatus =
	| "active"
	| "lost"
	| "stopping"
	| "sealed";

export type BroadcastActivation = {
	broadcastId: Id<"broadcasts">;
	sequence: number;
	lastCommitOrdinal: number;
};

export type BroadcastCommitInput = {
	sessionId: Id<"sessions">;
	broadcastId: Id<"broadcasts">;
	commitOrdinal: number;
	commitId: string;
	sourceText: string;
	sourceLanguage: string;
};

export type BroadcastCoordinatorAdapters = {
	connect: () => Promise<number | false>;
	disconnect: () => Promise<void>;
	start: (sessionId: Id<"sessions">) => Promise<BroadcastActivation>;
	resume: (broadcastId: Id<"broadcasts">) => Promise<BroadcastActivation>;
	heartbeat: (broadcastId: Id<"broadcasts">) => Promise<void>;
	stop: (args: { broadcastId: Id<"broadcasts"> }) => Promise<{
		lastCommitOrdinal: number;
	}>;
	acceptCommit: (args: BroadcastCommitInput) => Promise<void>;
};

export type BroadcastCoordinatorTimers = {
	setInterval: (handler: () => void, timeout: number) => number;
	clearInterval: (id: number) => void;
};

export type BroadcastCoordinatorSnapshot = {
	activeBroadcastId: Id<"broadcasts"> | null;
	optimisticCaptures: readonly OperatorCommitProjection[];
	rejectedCaptures: readonly RejectedCapture[];
	commandResult: {
		waiting: boolean;
		error: unknown | null;
	};
};

type CoordinatorLifecycle =
	| { tag: "idle" }
	| { tag: "starting" }
	| { tag: "active"; activation: BroadcastActivation }
	| { tag: "stopping"; activation: BroadcastActivation }
	| { tag: "sealed" };

const HEARTBEAT_INTERVAL_MS = 5_000;

const defaultTimers: BroadcastCoordinatorTimers = {
	setInterval: (handler, timeout) =>
		Number(globalThis.setInterval(handler, timeout)),
	clearInterval: (id) => globalThis.clearInterval(id),
};

function ignoreDisconnectTimeout(cause: unknown): void {
	if (cause instanceof DisconnectTimeout) return;
	throw cause;
}

function emptySnapshot(): BroadcastCoordinatorSnapshot {
	return {
		activeBroadcastId: null,
		optimisticCaptures: [],
		rejectedCaptures: [],
		commandResult: { waiting: false, error: null },
	};
}

export function createBroadcastCoordinator({
	onSnapshot,
	onError,
	timers = defaultTimers,
	rejectedCaptureOwner = createRejectedCaptureOwner(),
}: {
	onSnapshot?: (snapshot: BroadcastCoordinatorSnapshot) => void;
	onError?: (message: string) => void;
	timers?: BroadcastCoordinatorTimers;
	rejectedCaptureOwner?: RejectedCaptureOwner;
} = {}) {
	let adapters: BroadcastCoordinatorAdapters | null = null;
	let sessionId: Id<"sessions"> | undefined;
	let recoverableBroadcastId: Id<"broadcasts"> | null | undefined;
	let reportError = onError;
	let disposed = false;
	let lifecycle: CoordinatorLifecycle = { tag: "idle" };
	let realtimeFailed = false;
	let lastAcceptedOrdinal = 0;
	let captureBuffer: CaptureBuffer = createCaptureBuffer();
	let pagehideRequested = false;
	let heartbeatTimer: number | null = null;
	let heartbeatFailureReported = false;
	let commandWaiting = false;
	let commandError: unknown | null = null;
	let snapshot = emptySnapshot();
	let unsubscribeRejectedCaptureOwner = () => {};

	const commandGate = createBroadcastCommandGate();
	let serializedTail: Promise<void> = Promise.resolve();

	const serialize = <A>(operation: () => Promise<A>): Promise<A> => {
		const result = serializedTail.then(operation);
		serializedTail = result.then(
			() => undefined,
			() => undefined,
		);

		return result;
	};

	const getActiveActivation = () =>
		lifecycle.tag === "active" || lifecycle.tag === "stopping"
			? lifecycle.activation
			: null;

	const getActiveBroadcastId = () => getActiveActivation()?.broadcastId ?? null;

	const emit = () => {
		snapshot = {
			activeBroadcastId: getActiveBroadcastId(),
			optimisticCaptures: snapshot.optimisticCaptures,
			rejectedCaptures: sessionId ? rejectedCaptureOwner.read(sessionId) : [],
			commandResult: {
				waiting: commandWaiting,
				error: commandError,
			},
		};
		onSnapshot?.(snapshot);
	};

	unsubscribeRejectedCaptureOwner = rejectedCaptureOwner.subscribe(
		(changedSessionId) => {
			if (!disposed && changedSessionId === sessionId) emit();
		},
	);

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
		sessionId: Id<"sessions"> | undefined;
		recoverableBroadcastId: Id<"broadcasts"> | null | undefined;
		adapters: BroadcastCoordinatorAdapters;
		onError?: (message: string) => void;
	}) => {
		sessionId = input.sessionId;
		recoverableBroadcastId = input.recoverableBroadcastId;
		adapters = input.adapters;

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
		if (!sessionId || captures.length === 0) return false;

		return rejectedCaptureOwner.reject(sessionId, captures, reason);
	};

	const clearRejectedCapture = (commitId: string) => {
		if (!sessionId) return;
		rejectedCaptureOwner.remove(sessionId, commitId);
	};

	const clearRejectedCaptures = () => {
		if (!sessionId) return;
		rejectedCaptureOwner.discardAll(sessionId);
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

	const drainCaptures = async (): Promise<void> => {
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
				await currentAdapters.acceptCommit({
					sessionId: activeSessionId,
					broadcastId: activeBroadcastId,
					commitOrdinal: capture.commitOrdinal,
					commitId: capture.commitId,
					sourceText: capture.sourceText,
					sourceLanguage: capture.sourceLanguage,
				});
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

				const retained = markRejected(
					[capture],
					`Could not accept caption: ${toBroadcastCommandError(error).message}`,
				);

				if (retained) {
					reportError?.(
						"A caption could not be accepted. It remains available for export.",
					);
				}
			}
		}
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

	const clearActiveBroadcast = (
		lastCommitOrdinal?: number,
		pendingCaptureReason?: string,
	) => {
		lifecycle =
			lastCommitOrdinal === undefined ? { tag: "idle" } : { tag: "sealed" };
		pagehideRequested = false;

		if (lastCommitOrdinal !== undefined) {
			lastAcceptedOrdinal = lastCommitOrdinal;
		}

		if (pendingCaptureReason && captureBuffer.pending.length > 0) {
			markRejected(captureBuffer.pending, pendingCaptureReason);
			captureBuffer = { ...captureBuffer, pending: [] };
		}

		captureBuffer = {
			...captureBuffer,
			generation: captureBuffer.generation + 1,
			broadcastId: null,
		};
		updateHeartbeat();
		emit();
	};

	const getAdapters = () => {
		if (!adapters) {
			throw new BroadcastCommandError({ message: "Broadcast is not ready" });
		}

		return adapters;
	};

	const runAdapter = async <A>(operation: () => Promise<A>): Promise<A> => {
		try {
			return await operation();
		} catch (error) {
			throw toBroadcastCommandError(error);
		}
	};

	const startBroadcast = async (): Promise<BroadcastCommandResult> => {
		const activeSessionId = sessionId;

		if (!activeSessionId) {
			throw new BroadcastCommandError({ message: "Session is not loaded" });
		}

		const currentAdapters = getAdapters();
		lifecycle = { tag: "starting" };
		emit();
		pagehideRequested = false;
		realtimeFailed = false;

		const generation = await runAdapter(() => currentAdapters.connect());

		if (generation === false) {
			throw new BroadcastCommandError({
				message: "Realtime transcription could not connect",
			});
		}

		captureBuffer = { ...captureBuffer, generation };

		if (realtimeFailed) {
			throw new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}

		const recoverableId = recoverableBroadcastId;

		const activation = recoverableId
			? await runAdapter(() => currentAdapters.resume(recoverableId))
			: await runAdapter(() => currentAdapters.start(activeSessionId));

		lifecycle = { tag: "active", activation };
		lastAcceptedOrdinal = activation.lastCommitOrdinal;
		captureBuffer = activateCaptureBuffer(
			captureBuffer,
			activation.broadcastId,
			activation.lastCommitOrdinal,
		);
		updateHeartbeat();
		emit();

		let activationFailed = realtimeFailed;

		if (!activationFailed) {
			await drainCaptures();
			activationFailed = realtimeFailed;
		}

		if (activationFailed) {
			await runAdapter(() =>
				currentAdapters.stop({ broadcastId: activation.broadcastId }),
			);
			clearActiveBroadcast();
			throw new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}

		if (pagehideRequested) {
			pagehideRequested = false;
			await stopBroadcast();
		}

		return { kind: "start" as const, broadcastId: activation.broadcastId };
	};

	const stopBroadcast = async (): Promise<BroadcastCommandResult> => {
		const activeActivation = getActiveActivation();

		if (!activeActivation) {
			throw new BroadcastCommandError({ message: "Broadcast is not active" });
		}

		const activeBroadcastId = activeActivation.broadcastId;
		const currentAdapters = getAdapters();
		lifecycle = { tag: "stopping", activation: activeActivation };
		updateHeartbeat();
		emit();
		await runAdapter(() => currentAdapters.disconnect());
		await drainCaptures();

		const stopped = await runAdapter(() =>
			currentAdapters.stop({ broadcastId: activeBroadcastId }),
		);

		clearActiveBroadcast(
			stopped.lastCommitOrdinal,
			"Broadcast stopped before acceptance",
		);

		return { kind: "stop" as const, broadcastId: activeBroadcastId };
	};

	const run = async (
		command: BroadcastCommand,
	): Promise<BroadcastCommandResult> => {
		try {
			return await commandGate.run(async () => {
				commandWaiting = true;
				commandError = null;
				emit();

				try {
					return await serialize(() =>
						command.kind === "start" ? startBroadcast() : stopBroadcast(),
					);
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
			void serialize(async () => {
				await adapters?.disconnect().catch(ignoreDisconnectTimeout);
			});

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
		const capture = appendCaptureEvent(event);

		if (capture && getActiveBroadcastId()) {
			void serialize(drainCaptures);
		}
	};

	const dispose = () => {
		if (disposed) return;
		disposed = true;

		if (heartbeatTimer !== null) {
			timers.clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}

		rejectPendingCaptures("Broadcast scope was unmounted before acceptance");
		unsubscribeRejectedCaptureOwner();
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
