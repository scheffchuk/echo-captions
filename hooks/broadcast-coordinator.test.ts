import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import {
	type BroadcastActivation,
	type BroadcastCoordinatorAdapters,
	createBroadcastCoordinator,
} from "@/hooks/broadcast-coordinator";

function deferred<A>() {
	let resolve!: (value: A) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<A>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function makeAdapters(
	overrides: Partial<BroadcastCoordinatorAdapters> = {},
): BroadcastCoordinatorAdapters {
	return {
		connect: vi.fn(async () => 3),
		disconnect: vi.fn(async () => undefined),
		start: vi.fn(async () => ({
			broadcastId: "broadcast-1",
			sequence: 4,
			lastCommitOrdinal: 7,
		})),
		resume: vi.fn(async () => ({
			broadcastId: "broadcast-1",
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
		coordinator.update({
			sessionId: "session-1",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});

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
			broadcastId: "broadcast-1",
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
		coordinator.update({
			sessionId: "session-generations",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});

		await coordinator.run({ kind: "start" });
		await coordinator.run({ kind: "stop" });
		await coordinator.run({ kind: "start" });
		coordinator.offerCapture(capture("commit-stale", 3));
		coordinator.offerCapture(capture("commit-current", 4));
		await vi.waitFor(() =>
			expect(adapters.acceptCommit).toHaveBeenCalledOnce(),
		);

		expect(adapters.acceptCommit).toHaveBeenCalledWith(
			expect.objectContaining({ commitId: "commit-current" }),
		);
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
		coordinator.update({
			sessionId: "session-disconnect",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});
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
		coordinator.update({
			sessionId: "session-retry",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters: makeAdapters({ acceptCommit }),
		});
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
		coordinator.update({
			sessionId: "session-discard",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters: makeAdapters({ acceptCommit }),
		});
		await coordinator.run({ kind: "start" });

		coordinator.offerCapture(capture("commit-discard"));
		await vi.waitFor(() => {
			expect(coordinator.snapshot().rejectedCaptures).toHaveLength(1);
		});
		coordinator.clearRejectedCaptures();

		expect(coordinator.snapshot().rejectedCaptures).toEqual([]);
		coordinator.dispose();
	});

	it("rejects buffered captures when activation fails and disconnects realtime", async () => {
		const activation = deferred<BroadcastActivation>();
		const adapters = makeAdapters({
			start: vi.fn(() => activation.promise),
		});
		const coordinator = createBroadcastCoordinator();
		coordinator.update({
			sessionId: "session-activation-failure",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});

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
		coordinator.update({
			sessionId: "session-pagehide",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});
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
		coordinator.update({
			sessionId: "session-pagehide-stop",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});
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
		coordinator.update({
			sessionId: "session-realtime-activation-failure",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});
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
		coordinator.update({
			sessionId: "session-dispose",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});
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
					return 1 as unknown as ReturnType<typeof setInterval>;
				}),
				clearInterval: vi.fn(),
			},
		});
		coordinator.update({
			sessionId: "session-heartbeat",
			recoverableBroadcastId: null,
			adapters,
		});
		await coordinator.run({ kind: "start" });
		heartbeat();
		await settle();

		expect(onError).toHaveBeenCalledWith("Heartbeat failed");
		coordinator.dispose();
	});

	it("rejects duplicate commands through the coordinator seam", async () => {
		const starting = deferred<number>();
		const adapters = makeAdapters({
			connect: vi.fn(() => starting.promise),
		});
		const coordinator = createBroadcastCoordinator();
		coordinator.update({
			sessionId: "session-command-conflict",
			recoverableBroadcastId: null,
			broadcastStatus: "active",
			adapters,
		});

		const first = coordinator.run({ kind: "start" });
		await expect(coordinator.run({ kind: "start" })).rejects.toMatchObject({
			message: "Another Broadcast command is already running",
		});
		starting.resolve(3);
		await first;
		coordinator.dispose();
	});
});
