import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import {
	createRejectedCaptureOwner,
	type RejectedCaptureOwner,
} from "@/hooks/broadcast-capture";
import {
	type BroadcastActivation,
	type BroadcastCoordinatorAdapters,
	createBroadcastCoordinator,
} from "@/hooks/broadcast-coordinator";
import { testId } from "@/test/ids";

function deferred<A>() {
	let resolve!: (value: A) => void;
	let reject!: (cause: unknown) => void;

	const promise = new Promise<A>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

function makeAdapters(
	overrides: Partial<BroadcastCoordinatorAdapters> = {},
): BroadcastCoordinatorAdapters {
	const broadcastId = testId("broadcasts", "broadcast-1");

	return {
		connect: vi.fn(async () => 3),
		disconnect: vi.fn(async () => undefined),
		start: vi.fn(async () => ({
			broadcastId,
			sequence: 4,
			lastCommitOrdinal: 7,
		})),
		resume: vi.fn(async () => ({
			broadcastId,
			sequence: 4,
			lastCommitOrdinal: 7,
		})),
		heartbeat: vi.fn(async () => undefined),
		stop: vi.fn(async () => ({ lastCommitOrdinal: 8 })),
		acceptCommit: vi.fn(async () => undefined),
		...overrides,
	};
}

function capture(commitId: string, generation = 3) {
	return {
		generation,
		commitId,
		sourceText: commitId,
		sourceLanguage: "en",
		capturedAt: 100,
	};
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function configureCoordinator(
	coordinator: ReturnType<typeof createBroadcastCoordinator>,
	sessionId: string,
	adapters: BroadcastCoordinatorAdapters,
) {
	coordinator.update({
		sessionId: testId("sessions", sessionId),
		recoverableBroadcastId: null,
		adapters,
	});
}

async function coordinatorWithRejectedCapture(
	rejectedCaptureOwner: RejectedCaptureOwner,
	sessionId: string,
	commitId: string,
) {
	const coordinator = createBroadcastCoordinator({ rejectedCaptureOwner });
	configureCoordinator(
		coordinator,
		sessionId,
		makeAdapters({
			acceptCommit: vi.fn(async () => {
				throw new ConvexError({
					code: "broadcast_conflict",
					message: "Broadcast is no longer active",
				});
			}),
		}),
	);
	await coordinator.run({ kind: "start" });
	coordinator.offerCapture(capture(commitId));
	await vi.waitFor(() => {
		expect(coordinator.snapshot().rejectedCaptures).toHaveLength(1);
	});

	return coordinator;
}

describe("Broadcast coordinator", () => {
	it("accepts captures that arrive while Broadcast activation is pending in order", async () => {
		const activation = deferred<BroadcastActivation>();

		const acceptCommit = vi.fn<BroadcastCoordinatorAdapters["acceptCommit"]>(
			async () => undefined,
		);

		const adapters = makeAdapters({
			start: vi.fn(() => activation.promise),
			acceptCommit,
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-1", adapters);

		const command = coordinator.run({ kind: "start" });
		await Promise.resolve();
		coordinator.offerCapture({
			generation: 3,
			commitId: "commit-1",
			sourceText: "First",
			sourceLanguage: "en",
			capturedAt: 100,
		});
		activation.resolve({
			broadcastId: testId("broadcasts", "broadcast-1"),
			sequence: 4,
			lastCommitOrdinal: 7,
		});

		await command;

		expect(acceptCommit).toHaveBeenCalledWith({
			sessionId: "session-1",
			broadcastId: "broadcast-1",
			commitOrdinal: 8,
			commitId: "commit-1",
			sourceText: "First",
			sourceLanguage: "en",
		});
		coordinator.dispose();
	});

	it("ignores callbacks from an earlier realtime generation", async () => {
		const adapters = makeAdapters({
			connect: vi
				.fn<BroadcastCoordinatorAdapters["connect"]>()
				.mockResolvedValueOnce(3)
				.mockResolvedValueOnce(4),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-generations", adapters);

		await coordinator.run({ kind: "start" });
		await coordinator.run({ kind: "stop" });
		coordinator.offerCapture(capture("commit-stale-before-next-start", 3));
		await coordinator.run({ kind: "start" });
		coordinator.offerCapture(capture("commit-stale", 3));
		coordinator.offerCapture(capture("commit-current", 4));
		await vi.waitFor(() =>
			expect(adapters.acceptCommit).toHaveBeenCalledWith(
				expect.objectContaining({ commitId: "commit-current" }),
			),
		);
		expect(adapters.acceptCommit).toHaveBeenCalledOnce();
		coordinator.dispose();
	});

	it("drains captures delivered during disconnect before stopping the Broadcast", async () => {
		const disconnect = deferred<void>();

		const acceptCommit = vi.fn<BroadcastCoordinatorAdapters["acceptCommit"]>(
			async () => undefined,
		);

		const adapters = makeAdapters({
			disconnect: vi.fn(() => disconnect.promise),
			acceptCommit,
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-disconnect", adapters);
		await coordinator.run({ kind: "start" });

		coordinator.offerCapture(capture("commit-1"));
		const stopping = coordinator.run({ kind: "stop" });
		await settle();
		coordinator.offerCapture(capture("commit-2"));
		disconnect.resolve();
		await stopping;
		await settle();

		expect(acceptCommit).toHaveBeenCalledTimes(2);
		expect(
			acceptCommit.mock.calls.map(([input]) => input.commitOrdinal),
		).toEqual([8, 9]);
		expect(adapters.stop).toHaveBeenCalledWith({
			broadcastId: "broadcast-1",
		});
		coordinator.dispose();
	});

	it("retains a capture delivered after the drain boundary as rejected", async () => {
		const stopping = deferred<{ lastCommitOrdinal: number }>();

		const adapters = makeAdapters({
			stop: vi.fn(() => stopping.promise),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-stop-boundary", adapters);
		await coordinator.run({ kind: "start" });

		const stoppingCommand = coordinator.run({ kind: "stop" });
		await vi.waitFor(() => expect(adapters.stop).toHaveBeenCalledOnce());
		coordinator.offerCapture(capture("commit-after-drain", 3));
		stopping.resolve({ lastCommitOrdinal: 7 });
		await stoppingCommand;

		expect(coordinator.snapshot().rejectedCaptures).toMatchObject([
			{ commitId: "commit-after-drain" },
		]);
		coordinator.dispose();
	});

	it("rebases later captures after an acceptance failure and keeps the failed capture exportable", async () => {
		const acceptCommit = vi
			.fn<BroadcastCoordinatorAdapters["acceptCommit"]>()
			.mockRejectedValueOnce(
				new ConvexError({
					code: "broadcast_conflict",
					message: "Broadcast is no longer active",
				}),
			)
			.mockResolvedValue(undefined);

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(
			coordinator,
			"session-retry",
			makeAdapters({ acceptCommit }),
		);
		await coordinator.run({ kind: "start" });

		coordinator.offerCapture(capture("commit-failed"));
		coordinator.offerCapture(capture("commit-later"));
		await vi.waitFor(() => {
			expect(coordinator.snapshot().rejectedCaptures).toHaveLength(1);
		});

		expect(coordinator.snapshot().rejectedCaptures[0]).toMatchObject({
			commitId: "commit-failed",
			commitOrdinal: 8,
		});
		expect(
			acceptCommit.mock.calls.map(([input]) => input.commitOrdinal),
		).toEqual([8, 8]);
		coordinator.dispose();
	});

	it("allows rejected captures to be discarded from the session export", async () => {
		const acceptCommit = vi.fn<BroadcastCoordinatorAdapters["acceptCommit"]>(
			async () => {
				throw new ConvexError({
					code: "broadcast_conflict",
					message: "Broadcast is no longer active",
				});
			},
		);

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(
			coordinator,
			"session-discard",
			makeAdapters({ acceptCommit }),
		);
		await coordinator.run({ kind: "start" });

		coordinator.offerCapture(capture("commit-discard"));
		await vi.waitFor(() => {
			expect(coordinator.snapshot().rejectedCaptures).toHaveLength(1);
		});
		coordinator.clearRejectedCaptures();

		expect(coordinator.snapshot().rejectedCaptures).toEqual([]);
		coordinator.dispose();
	});

	it("keeps rejected captures available when the coordinator remounts for the same Session", async () => {
		const rejectedCaptureOwner = createRejectedCaptureOwner();

		const firstCoordinator = await coordinatorWithRejectedCapture(
			rejectedCaptureOwner,
			"session-remount",
			"commit-remount",
		);

		firstCoordinator.dispose();

		const remountedCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
		});

		configureCoordinator(
			remountedCoordinator,
			"session-remount",
			makeAdapters(),
		);

		expect(remountedCoordinator.snapshot().rejectedCaptures).toMatchObject([
			{ commitId: "commit-remount" },
		]);
		remountedCoordinator.clearRejectedCaptures();
		remountedCoordinator.dispose();
	});

	it("keeps a remounted coordinator in sync while the disposed coordinator settles a capture", async () => {
		const rejectedCaptureOwner = createRejectedCaptureOwner();
		const acceptance = deferred<void>();

		const firstCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
		});

		configureCoordinator(
			firstCoordinator,
			"session-in-flight-remount",
			makeAdapters({ acceptCommit: vi.fn(() => acceptance.promise) }),
		);
		await firstCoordinator.run({ kind: "start" });
		firstCoordinator.offerCapture(capture("commit-in-flight-remount"));
		await vi.waitFor(() => {
			expect(firstCoordinator.snapshot().optimisticCaptures).toHaveLength(1);
		});

		const remountedCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
		});

		configureCoordinator(
			remountedCoordinator,
			"session-in-flight-remount",
			makeAdapters(),
		);
		firstCoordinator.dispose();

		expect(remountedCoordinator.snapshot().rejectedCaptures).toMatchObject([
			{ commitId: "commit-in-flight-remount" },
		]);
		acceptance.resolve();
		await vi.waitFor(() => {
			expect(remountedCoordinator.snapshot().rejectedCaptures).toEqual([]);
		});
		remountedCoordinator.dispose();
	});

	it("does not restore an explicitly discarded capture after a disposed coordinator fails", async () => {
		const rejectedCaptureOwner = createRejectedCaptureOwner();
		const acceptance = deferred<void>();
		const onError = vi.fn();

		const firstCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
			onError,
		});

		configureCoordinator(
			firstCoordinator,
			"session-discard-in-flight",
			makeAdapters({ acceptCommit: vi.fn(() => acceptance.promise) }),
		);
		await firstCoordinator.run({ kind: "start" });
		firstCoordinator.offerCapture(capture("commit-discard-in-flight"));
		await vi.waitFor(() => {
			expect(firstCoordinator.snapshot().optimisticCaptures).toHaveLength(1);
		});

		const remountedCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
		});

		configureCoordinator(
			remountedCoordinator,
			"session-discard-in-flight",
			makeAdapters(),
		);
		firstCoordinator.dispose();
		expect(remountedCoordinator.snapshot().rejectedCaptures).toHaveLength(1);
		remountedCoordinator.clearRejectedCaptures();
		expect(remountedCoordinator.snapshot().rejectedCaptures).toEqual([]);

		acceptance.reject(
			new ConvexError({
				code: "broadcast_conflict",
				message: "Broadcast is no longer active",
			}),
		);
		await vi.waitFor(() => {
			expect(firstCoordinator.snapshot().optimisticCaptures).toEqual([]);
		});
		expect(onError).not.toHaveBeenCalled();
		expect(remountedCoordinator.snapshot().rejectedCaptures).toEqual([]);
		remountedCoordinator.dispose();
	});

	it("isolates rejected captures by Session within one owner", async () => {
		const rejectedCaptureOwner = createRejectedCaptureOwner();

		const firstSessionCoordinator = await coordinatorWithRejectedCapture(
			rejectedCaptureOwner,
			"session-isolated-a",
			"commit-isolated",
		);

		firstSessionCoordinator.dispose();

		const secondSessionCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
		});

		configureCoordinator(
			secondSessionCoordinator,
			"session-isolated-b",
			makeAdapters(),
		);

		expect(secondSessionCoordinator.snapshot().rejectedCaptures).toEqual([]);
		secondSessionCoordinator.dispose();

		const restoredSessionCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner,
		});

		configureCoordinator(
			restoredSessionCoordinator,
			"session-isolated-a",
			makeAdapters(),
		);
		expect(
			restoredSessionCoordinator.snapshot().rejectedCaptures,
		).toMatchObject([{ commitId: "commit-isolated" }]);
		restoredSessionCoordinator.clearRejectedCaptures();
		restoredSessionCoordinator.dispose();
	});

	it("does not leak rejected captures between independent owners", async () => {
		const firstOwnerCoordinator = await coordinatorWithRejectedCapture(
			createRejectedCaptureOwner(),
			"session-owner-isolation",
			"commit-first-owner",
		);

		const secondOwnerCoordinator = createBroadcastCoordinator({
			rejectedCaptureOwner: createRejectedCaptureOwner(),
		});

		configureCoordinator(
			secondOwnerCoordinator,
			"session-owner-isolation",
			makeAdapters(),
		);

		expect(secondOwnerCoordinator.snapshot().rejectedCaptures).toEqual([]);
		firstOwnerCoordinator.clearRejectedCaptures();
		firstOwnerCoordinator.dispose();
		secondOwnerCoordinator.dispose();
	});

	it("rejects buffered captures when activation fails and disconnects realtime", async () => {
		const activation = deferred<BroadcastActivation>();

		const adapters = makeAdapters({
			start: vi.fn(() => activation.promise),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-activation-failure", adapters);

		const starting = coordinator.run({ kind: "start" });
		await settle();
		coordinator.offerCapture(capture("commit-lost"));
		activation.reject(
			new ConvexError({
				code: "broadcast_conflict",
				message: "Could not activate Broadcast",
			}),
		);

		await expect(starting).rejects.toMatchObject({
			message: "Could not activate Broadcast",
		});
		await vi.waitFor(() => {
			expect(coordinator.snapshot().rejectedCaptures).toHaveLength(1);
		});
		expect(adapters.disconnect).toHaveBeenCalled();
		coordinator.dispose();
	});

	it("stops the Broadcast on pagehide while preserving the normal stop sequence", async () => {
		const stopping = deferred<{ lastCommitOrdinal: number }>();

		const adapters = makeAdapters({
			stop: vi.fn(() => stopping.promise),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-pagehide", adapters);
		await coordinator.run({ kind: "start" });

		coordinator.handlePagehide();
		await vi.waitFor(() => expect(adapters.stop).toHaveBeenCalledOnce());
		stopping.resolve({ lastCommitOrdinal: 7 });
		await vi.waitFor(() => {
			expect(coordinator.snapshot().activeBroadcastId).toBeNull();
		});
		coordinator.dispose();
	});

	it("does not disconnect twice when pagehide arrives during stop", async () => {
		const disconnecting = deferred<void>();

		const adapters = makeAdapters({
			disconnect: vi.fn(() => disconnecting.promise),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-pagehide-stop", adapters);
		await coordinator.run({ kind: "start" });

		const stopping = coordinator.run({ kind: "stop" });
		await vi.waitFor(() => expect(adapters.disconnect).toHaveBeenCalledOnce());
		coordinator.handlePagehide();
		expect(adapters.disconnect).toHaveBeenCalledOnce();
		disconnecting.resolve();
		await stopping;
		coordinator.dispose();
	});

	it("stops a partially activated Broadcast when realtime fails while draining", async () => {
		const accepting = deferred<void>();

		const adapters = makeAdapters({
			acceptCommit: vi.fn(() => accepting.promise),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(
			coordinator,
			"session-realtime-activation-failure",
			adapters,
		);
		coordinator.offerCapture(capture("commit-during-activation"));

		const starting = coordinator.run({ kind: "start" });
		await vi.waitFor(() =>
			expect(adapters.acceptCommit).toHaveBeenCalledOnce(),
		);
		coordinator.handleRealtimeError("Realtime transcription failed");
		accepting.resolve();

		await expect(starting).rejects.toMatchObject({
			message: "Realtime transcription failed during activation",
		});
		expect(adapters.stop).toHaveBeenCalledWith({
			broadcastId: "broadcast-1",
		});
		coordinator.dispose();
	});

	it("rejects queued captures and disconnects when the Broadcast scope is disposed", async () => {
		const adapters = makeAdapters();
		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-dispose", adapters);
		coordinator.offerCapture(capture("commit-unmounted", 0));
		coordinator.dispose();

		expect(coordinator.snapshot().rejectedCaptures).toMatchObject([
			{ commitId: "commit-unmounted" },
		]);
		expect(adapters.disconnect).toHaveBeenCalledOnce();
	});

	it("owns one heartbeat interval for an active Broadcast and reports its first failure", async () => {
		let heartbeat!: () => void;
		const onError = vi.fn();

		const adapters = makeAdapters({
			heartbeat: vi.fn(async () => {
				throw new ConvexError({
					code: "broadcast_conflict",
					message: "Heartbeat failed",
				});
			}),
		});

		const coordinator = createBroadcastCoordinator({
			onError,
			timers: {
				setInterval: vi.fn((callback) => {
					heartbeat = callback;

					return 1;
				}),
				clearInterval: vi.fn(),
			},
		});

		configureCoordinator(coordinator, "session-heartbeat", adapters);
		await coordinator.run({ kind: "start" });
		heartbeat();
		await settle();

		expect(onError).toHaveBeenCalledWith("Heartbeat failed");
		coordinator.dispose();
	});

	it("resumes heartbeats and caption acceptance after a development remount", async () => {
		let heartbeat!: () => void;

		const adapters = makeAdapters();

		const coordinator = createBroadcastCoordinator({
			timers: {
				setInterval: vi.fn((callback) => {
					heartbeat = callback;

					return 1;
				}),
				clearInterval: vi.fn(),
			},
		});

		configureCoordinator(coordinator, "session-remount", adapters);
		coordinator.dispose();
		configureCoordinator(coordinator, "session-remount", adapters);
		await coordinator.run({ kind: "start" });
		expect(adapters.heartbeat).toHaveBeenCalledOnce();
		heartbeat();
		await settle();

		expect(adapters.heartbeat).toHaveBeenCalledTimes(2);
		coordinator.offerCapture(capture("commit-after-remount"));
		await vi.waitFor(() =>
			expect(adapters.acceptCommit).toHaveBeenCalledWith(
				expect.objectContaining({ commitId: "commit-after-remount" }),
			),
		);
		coordinator.dispose();
	});

	it("rejects duplicate commands through the coordinator seam", async () => {
		const starting = deferred<number>();

		const adapters = makeAdapters({
			connect: vi.fn(() => starting.promise),
		});

		const coordinator = createBroadcastCoordinator();
		configureCoordinator(coordinator, "session-command-conflict", adapters);

		const first = coordinator.run({ kind: "start" });
		await expect(coordinator.run({ kind: "start" })).rejects.toMatchObject({
			message: "Another Broadcast command is already running",
		});
		starting.resolve(3);
		await first;
		coordinator.dispose();
	});
});
