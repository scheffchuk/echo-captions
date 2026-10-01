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
	abandon: (args: { broadcastId: Id<"broadcasts"> }) => Promise<{
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
		kind: BroadcastCommand["kind"] | null;
		error: unknown | null;
	};
};

type CoordinatorLifecycle =
	| { tag: "idle" }
	| { tag: "starting" }
	| { tag: "active"; activation: BroadcastActivation }
	| { tag: "stopping"; activation: BroadcastActivation }
	| { tag: "abandoning" }
	| { tag: "sealed" };

const HEARTBEAT_INTERVAL_MS = 5_000;

const defaultTimers: BroadcastCoordinatorTimers = {
	setInterval: (handler, timeout) =>
		Number(globalThis.setInterval(handler, timeout)),
	clearInterval: (id) => globalThis.clearInterval(id),
};

function emptySnapshot(): BroadcastCoordinatorSnapshot {
	return {
		activeBroadcastId: null,
		optimisticCaptures: [],
		rejectedCaptures: [],
		commandResult: { waiting: false, kind: null, error: null },
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
	let recordingAdapters: BroadcastCoordinatorAdapters | null = null;
	let sessionId: Id<"sessions"> | undefined;
	let recoverableBroadcastId: Id<"broadcasts"> | null | undefined;
	let reportError = onError;
	let disposed = false;
	let departing = false;
	let disconnectResult: Promise<PromiseSettledResult<void>> | null = null;
	let lifecycle: CoordinatorLifecycle = { tag: "idle" };
	let realtimeFailed = false;
	let lastAcceptedOrdinal = 0;
	let captureBuffer: CaptureBuffer = createCaptureBuffer();
	let heartbeatTimer: number | null = null;
	let heartbeatFailureReported = false;
	let commandKind: BroadcastCommand["kind"] | null = null;
	let commandError: unknown | null = null;
	let snapshot = emptySnapshot();
	let unsubscribeRejectedCaptureOwner = () => {};

	const commandGate = createBroadcastCommandGate();
	const presentedDisconnectTimeouts = new WeakSet<DisconnectTimeout>();
	let serializedTail: Promise<void> = Promise.resolve();

	const presentFailure = (
		failure: ReturnType<typeof toBroadcastCommandError>,
	) => {
		if (failure instanceof DisconnectTimeout) {
			if (presentedDisconnectTimeouts.has(failure)) return;
			presentedDisconnectTimeouts.add(failure);
		}

		reportError?.(failure.message);
	};

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
				waiting: commandKind !== null,
				kind: commandKind,
				error: commandError,
			},
		};

		if (!disposed) onSnapshot?.(snapshot);
	};

	const subscribeRejectedCaptures = () => {
		unsubscribeRejectedCaptureOwner();
		unsubscribeRejectedCaptureOwner = rejectedCaptureOwner.subscribe(
			(changedSessionId) => {
				if (!disposed && changedSessionId === sessionId) emit();
			},
		);
	};

	subscribeRejectedCaptures();

	const updateHeartbeat = () => {
		const activeBroadcastId = getActiveBroadcastId();

		const shouldHeartbeat =
			!departing && lifecycle.tag === "active" && activeBroadcastId !== null;

		if (!shouldHeartbeat && heartbeatTimer !== null) {
			timers.clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}

		if (shouldHeartbeat && heartbeatTimer === null) {
			heartbeatFailureReported = false;

			const sendHeartbeat = () => {
				const currentBroadcastId =
					lifecycle.tag === "active" ? lifecycle.activation.broadcastId : null;

				const currentAdapters = recordingAdapters;

				if (!currentBroadcastId || !currentAdapters) return;
				void currentAdapters.heartbeat(currentBroadcastId).catch((error) => {
					const failure = toBroadcastCommandError(error);

					if (heartbeatFailureReported) return;
					heartbeatFailureReported = true;
					reportError?.(failure.message);
				});
			};

			heartbeatTimer = timers.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
			sendHeartbeat();
		}
	};

	const update = (input: {
		sessionId: Id<"sessions"> | undefined;
		recoverableBroadcastId: Id<"broadcasts"> | null | undefined;
		adapters: BroadcastCoordinatorAdapters;
		onError?: (message: string) => void;
	}) => {
		if (departing) return;
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
		while (lifecycle.tag !== "abandoning" && captureBuffer.pending.length > 0) {
			const capture = captureBuffer.pending[0];
			const activeBroadcastId = getActiveBroadcastId();
			const activeSessionId = sessionId;
			const currentAdapters = recordingAdapters;

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

	const disconnectOnce = (
		currentAdapters = recordingAdapters ?? getAdapters(),
	) => {
		disconnectResult ??= Promise.allSettled([
			currentAdapters.disconnect(),
		]).then(([result]) => result);

		return disconnectResult;
	};

	const startBroadcast = async (
		activeSessionId: Id<"sessions"> | undefined,
		recoverableId: Id<"broadcasts"> | null | undefined,
		currentAdapters: BroadcastCoordinatorAdapters,
	): Promise<BroadcastCommandResult> => {
		if (departing)
			throw new BroadcastCommandError({
				message: "Broadcast scope is closing",
			});

		if (!activeSessionId) {
			throw new BroadcastCommandError({ message: "Session is not loaded" });
		}

		const reusableGeneration =
			lifecycle.tag === "active" &&
			lifecycle.activation.broadcastId === recoverableId &&
			!realtimeFailed
				? captureBuffer.generation
				: null;

		recordingAdapters = currentAdapters;
		disconnectResult = null;
		lifecycle = { tag: "starting" };
		emit();
		realtimeFailed = false;

		const generation =
			reusableGeneration ?? (await runAdapter(() => currentAdapters.connect()));

		if (generation === false) {
			throw new BroadcastCommandError({
				message: "Realtime transcription could not connect",
			});
		}

		captureBuffer = { ...captureBuffer, generation };

		if (departing)
			throw new BroadcastCommandError({
				message: "Broadcast scope is closing",
			});

		if (realtimeFailed) {
			throw new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}

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
			await stopBroadcast(activation.broadcastId);
			throw new BroadcastCommandError({
				message: "Realtime transcription failed during activation",
			});
		}

		if (departing) {
			await stopBroadcast(activation.broadcastId);
		}

		return { kind: "start" as const, broadcastId: activation.broadcastId };
	};

	const stopBroadcast = async (
		broadcastId: Id<"broadcasts">,
	): Promise<BroadcastCommandResult> => {
		const activeActivation = getActiveActivation();

		if (!activeActivation || activeActivation.broadcastId !== broadcastId) {
			throw new BroadcastCommandError({ message: "Broadcast is not active" });
		}

		const activeBroadcastId = activeActivation.broadcastId;
		const currentAdapters = recordingAdapters ?? getAdapters();
		lifecycle = { tag: "stopping", activation: activeActivation };
		updateHeartbeat();
		emit();
		const cleanup = await disconnectOnce(currentAdapters);

		if (cleanup.status === "rejected")
			throw toBroadcastCommandError(cleanup.reason);
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

	const abandonBroadcast = async (
		broadcastId: Id<"broadcasts">,
		currentAdapters: BroadcastCoordinatorAdapters,
	): Promise<BroadcastCommandResult> => {
		lifecycle = { tag: "abandoning" };
		updateHeartbeat();

		try {
			const [server, cleanup] = await Promise.allSettled([
				runAdapter(() => currentAdapters.abandon({ broadcastId })),
				disconnectOnce(currentAdapters),
			]);

			if (cleanup.status === "rejected") throw cleanup.reason;

			if (cleanup.value.status === "rejected") {
				const failure = toBroadcastCommandError(cleanup.value.reason);

				if (!(failure instanceof DisconnectTimeout)) throw failure;
				presentFailure(failure);
			}

			if (server.status === "rejected") throw server.reason;
		} finally {
			rejectPendingCaptures("Broadcast tail was explicitly abandoned");
			clearActiveBroadcast();
		}

		return { kind: "abandon", broadcastId };
	};

	const run = async (
		command: BroadcastCommand,
	): Promise<BroadcastCommandResult> => {
		try {
			return await commandGate.run(async () => {
				if (departing)
					throw new BroadcastCommandError({
						message: "Broadcast scope is closing",
					});
				const commandAdapters = getAdapters();
				const commandSessionId = sessionId;
				const commandRecoverableId = recoverableBroadcastId;
				const previousActivation = getActiveActivation();

				if (
					command.kind === "start" &&
					lifecycle.tag === "active" &&
					lifecycle.activation.broadcastId !== commandRecoverableId
				) {
					throw new BroadcastCommandError({
						message: "Broadcast is already active",
					});
				}

				if (command.kind === "stop") {
					const activation = getActiveActivation();

					if (!activation || activation.broadcastId !== command.broadcastId) {
						throw new BroadcastCommandError({
							message: "The active Broadcast has changed",
						});
					}

					lifecycle = { tag: "stopping", activation };
					disconnectOnce();
				} else if (command.kind === "abandon") {
					if (recoverableBroadcastId !== command.broadcastId) {
						throw new BroadcastCommandError({
							message: "The Lost Broadcast has changed",
						});
					}

					lifecycle = { tag: "abandoning" };
					disconnectOnce();
				}

				updateHeartbeat();
				commandKind = command.kind;
				commandError = null;
				emit();

				try {
					return await serialize(() => {
						switch (command.kind) {
							case "start":
								return startBroadcast(
									commandSessionId,
									commandRecoverableId,
									commandAdapters,
								);
							case "stop":
								return stopBroadcast(command.broadcastId);
							case "abandon":
								return abandonBroadcast(command.broadcastId, commandAdapters);
						}
					});
				} catch (error) {
					if (command.kind === "start") {
						const cleanup = await disconnectOnce();
						const activation = getActiveActivation() ?? previousActivation;

						if (
							activation &&
							(lifecycle.tag === "starting" || lifecycle.tag === "active") &&
							cleanup.status === "fulfilled"
						) {
							lifecycle = { tag: "active", activation };
							await stopBroadcast(activation.broadcastId).catch((cause) => {
								presentFailure(toBroadcastCommandError(cause));
							});
						}

						clearActiveBroadcast();
						const failure = toBroadcastCommandError(error);
						rejectPendingCaptures(
							`Broadcast activation failed: ${failure.message}`,
						);

						if (
							cleanup.status === "rejected" &&
							!(cleanup.reason instanceof DisconnectTimeout)
						) {
							throw toBroadcastCommandError(cleanup.reason);
						}

						throw failure;
					}

					throw error;
				} finally {
					commandKind = null;
					emit();
				}
			});
		} catch (error) {
			const failure = toBroadcastCommandError(error);
			commandError = failure;
			emit();
			presentFailure(failure);
			throw failure;
		}
	};

	const handleRealtimeError = (message: string) => {
		realtimeFailed = true;

		if (departing) return;

		if (commandGate.isBusy()) return;
		reportError?.(message);

		const broadcastId = getActiveBroadcastId();

		if (!broadcastId) return;
		void run({ kind: "stop", broadcastId }).catch(
			ignorePresentedBroadcastError,
		);
	};

	const handlePagehide = () => {
		if (departing) return;
		departing = true;
		updateHeartbeat();

		if (!adapters) return;

		const cleanupAlreadyOwned =
			disconnectResult !== null || commandGate.isBusy();

		const cleanup = disconnectOnce();
		void serialize(async () => {
			if (lifecycle.tag === "active") {
				await stopBroadcast(lifecycle.activation.broadcastId);
			} else {
				const result = await cleanup;

				if (!cleanupAlreadyOwned && result.status === "rejected")
					throw toBroadcastCommandError(result.reason);
			}

			rejectPendingCaptures("Broadcast scope was left before acceptance");
		}).catch((cause) => {
			rejectPendingCaptures("Broadcast scope was left before acceptance");
			presentFailure(toBroadcastCommandError(cause));
		});
	};

	const offerCapture = (event: CaptureEvent) => {
		const capture = appendCaptureEvent(event);

		if (capture && (disposed || lifecycle.tag === "abandoning")) {
			markRejected([capture], "Broadcast scope closed before acceptance");
		}

		if (capture && !departing && getActiveBroadcastId()) {
			void serialize(drainCaptures);
		}
	};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		markRejected(
			captureBuffer.pending,
			"Broadcast scope was unmounted before acceptance",
		);
		unsubscribeRejectedCaptureOwner();
		handlePagehide();
		emit();
	};

	return {
		update,
		run,
		offerCapture,
		handleRealtimeError,
		handlePagehide,
		dispose,
		clearRejectedCaptures,
		snapshot: () => snapshot,
	};
}
