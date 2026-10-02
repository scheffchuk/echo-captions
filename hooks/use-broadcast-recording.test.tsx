// @vitest-environment jsdom

import type { ScribeHookOptions, ScribeStatus } from "@elevenlabs/react";
import { act, render, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import {
	createRef,
	type ReactNode,
	StrictMode,
	useSyncExternalStore,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BroadcastAdaptersProvider,
	type BroadcastCommands,
} from "@/hooks/broadcast-adapters";
import {
	BroadcastCommandConflict,
	BroadcastCommandError,
	DisconnectTimeout,
} from "@/hooks/broadcast-model";
import { RejectedCaptureOwnerProvider } from "@/hooks/rejected-capture-owner";
import { useBroadcastRecording } from "@/hooks/use-broadcast-recording";
import type { RealtimeScribeHandlers } from "@/hooks/use-realtime-connection";
import { testId } from "@/test/ids";

const sessionId = testId("sessions", "recording-session");

const broadcastId = testId("broadcasts", "recording-broadcast");

function deferred<A>() {
	let resolve!: (value: A) => void;
	let reject!: (cause: unknown) => void;

	const promise = new Promise<A>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

function makeRecordingAdapters() {
	let connectionCallbacks: ScribeHookOptions = {};
	let status: ScribeStatus = "disconnected";
	let connection: { close: () => void } | null = null;
	let mediaReleased = true;
	let acknowledgeDisconnect = true;
	let acknowledgeConnect = true;
	let closingCaption: string | null = null;
	let handlersAttached = false;
	const listeners = new Set<() => void>();

	const notify = () => {
		for (const listener of listeners) listener();
	};

	const activation: Awaited<ReturnType<BroadcastCommands["start"]>> = {
		broadcastId,
		sequence: 1,
		lastCommitOrdinal: 0,
		status: "active",
	};

	const receipt: Awaited<ReturnType<BroadcastCommands["acceptCommit"]>> = {
		acceptedCommitId: testId("acceptedCommits", "accepted-recording-caption"),
		commitId: "accepted-caption",
		status: "pending",
		sequence: 1,
		targetCount: 0,
		completedTargetCount: 0,
		failedTargetCount: 0,
		segmentId: null,
	};

	const commands = {
		start: vi.fn<BroadcastCommands["start"]>(async () => activation),
		resume: vi.fn<BroadcastCommands["resume"]>(async () => ({
			...activation,
			finalCommitOrdinal: undefined,
		})),
		stop: vi.fn<BroadcastCommands["stop"]>(async () => ({
			...activation,
			status: "sealed",
			finalCommitOrdinal: 0,
		})),
		abandon: vi.fn<BroadcastCommands["abandon"]>(async () => ({
			...activation,
			status: "sealed",
			finalCommitOrdinal: 0,
		})),
		heartbeat: vi.fn(async () => null),
		acceptCommit: vi.fn<BroadcastCommands["acceptCommit"]>(async () => receipt),
		getScribeToken: vi.fn(async () => ({ token: "test-token" })),
	} satisfies BroadcastCommands;

	const close = vi.fn(() => {
		mediaReleased = true;
		connection = null;
		status = "disconnected";
		notify();

		if (closingCaption)
			connectionCallbacks.onCommittedTranscriptWithTimestamps?.({
				text: closingCaption,
				words: [],
			});

		if (acknowledgeDisconnect) connectionCallbacks.onDisconnect?.();
	});

	const scribe = {
		connect: vi.fn(async () => {
			mediaReleased = false;
			connection = { close };
			status = "connected";
			notify();
		}),
		disconnect: close,
		getConnection: () => connection,
		clearTranscripts: () => {},
		registerHandlers: (handlers: RealtimeScribeHandlers) => {
			handlersAttached = true;
			connectionCallbacks = handlers;

			if (acknowledgeConnect) handlers.onConnect();

			return () => {
				handlersAttached = false;
			};
		},
	};

	const adapters = {
		useCommands: () => commands,
		useScribe: () => {
			const currentStatus = useSyncExternalStore(
				(listener) => {
					listeners.add(listener);

					return () => {
						listeners.delete(listener);
					};
				},
				() => status,
			);

			return {
				...scribe,
				status: currentStatus,
				isConnected: currentStatus === "connected",
				partialTranscript: "",
			};
		},
	};

	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<RejectedCaptureOwnerProvider>
				<BroadcastAdaptersProvider adapters={adapters}>
					<StrictMode>{children}</StrictMode>
				</BroadcastAdaptersProvider>
			</RejectedCaptureOwnerProvider>
		);
	}

	return {
		receipt,
		commands,
		scribe,
		Wrapper,
		mediaReleased: () => mediaReleased,
		handlersAttached: () => handlersAttached,
		setAcknowledgeDisconnect: (value: boolean) => {
			acknowledgeDisconnect = value;
		},
		setAcknowledgeConnect: (value: boolean) => {
			acknowledgeConnect = value;
		},
		error: () => connectionCallbacks.onAuthError?.({ error: "Unauthorized" }),
		setClosingCaption: (value: string) => {
			closingCaption = value;
		},
		caption: (text: string) =>
			connectionCallbacks.onCommittedTranscriptWithTimestamps?.({
				text,
				words: [],
			}),
		connectionCallbacks: () => connectionCallbacks,
	};
}

function mountRecording(
	fixture: ReturnType<typeof makeRecordingAdapters>,
	initialProps: Parameters<typeof useBroadcastRecording>[0] = {
		sessionId,
		deviceId: "mic",
	},
) {
	return renderHook(useBroadcastRecording, {
		initialProps,
		wrapper: fixture.Wrapper,
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("mounted Broadcast recording", () => {
	it("stops a recovered activation only once when realtime fails during recovery", async () => {
		const fixture = makeRecordingAdapters();

		const resumed =
			deferred<Awaited<ReturnType<BroadcastCommands["resume"]>>>();

		fixture.commands.resume.mockImplementationOnce(() => resumed.promise);
		const onError = vi.fn();

		const { result, rerender, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
			onError,
		});
		let recovering!: ReturnType<typeof result.current.run>;
		act(() => {
			recovering = result.current.run({ kind: "start" });
		});
		const outcome = recovering.catch((cause) => cause);
		await act(async () => {});
		act(() => fixture.error());
		await act(async () => {
			resumed.resolve({
				broadcastId,
				sequence: 1,
				lastCommitOrdinal: 0,
				status: "active",
				finalCommitOrdinal: undefined,
			});
			await expect(outcome).resolves.toBeInstanceOf(BroadcastCommandError);
		});
		unmount();
		await act(async () => {});
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			"Realtime transcription failed during activation",
		);
	});

	it("attempts normal stop when departure is followed by failed same-connection recovery", async () => {
		const fixture = makeRecordingAdapters();

		const resumed =
			deferred<Awaited<ReturnType<BroadcastCommands["resume"]>>>();

		fixture.commands.resume.mockImplementationOnce(() => resumed.promise);
		const onError = vi.fn();

		const { result, rerender, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
			onError,
		});
		let recovering!: ReturnType<typeof result.current.run>;
		act(() => {
			recovering = result.current.run({ kind: "start" });
		});
		const outcome = recovering.catch((cause) => cause);
		await act(async () => {});
		unmount();
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {
			resumed.reject(new ConvexError({ message: "Recovery refused" }));
			await outcome;
		});
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledExactlyOnceWith("Recovery refused");
	});
	it("rejects start on an active Broadcast without disconnecting it", async () => {
		const fixture = makeRecordingAdapters();
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		await act(async () => {
			await expect(
				result.current.run({ kind: "start" }),
			).rejects.toBeInstanceOf(BroadcastCommandError);
		});
		expect(fixture.mediaReleased()).toBe(false);
		expect(result.current.activeBroadcastId).toBe(broadcastId);
		expect(fixture.commands.start).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(1);
		unmount();
	});
	it("resumes the confirmed Lost Broadcast using its still-live connection", async () => {
		const fixture = makeRecordingAdapters();
		const { result, rerender, unmount } = mountRecording(fixture);
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
		});
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		expect(fixture.commands.resume).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(fixture.scribe.connect).toHaveBeenCalledTimes(1);
		expect(fixture.mediaReleased()).toBe(false);
		unmount();
	});
	it("can restart after a documented connection failure and acknowledged cleanup", async () => {
		const fixture = makeRecordingAdapters();
		fixture.setAcknowledgeConnect(false);
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		let starting!: ReturnType<typeof result.current.run>;
		act(() => {
			starting = result.current.run({ kind: "start" });
		});
		const outcome = starting.catch((cause) => cause);
		await act(async () => {});
		await act(async () => {
			fixture.error();
			await expect(outcome).resolves.toMatchObject({
				message: "Realtime transcription authorization failed.",
			});
		});
		expect(fixture.mediaReleased()).toBe(true);
		expect(fixture.handlersAttached()).toBe(false);
		fixture.setAcknowledgeConnect(true);
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		expect(fixture.commands.start).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(1);
		unmount();
	});
	it("owns beforeunload protection only for its mounted recording lifetime", async () => {
		const fixture = makeRecordingAdapters();
		const { result, unmount } = mountRecording(fixture);
		const idle = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(idle);
		expect(idle.defaultPrevented).toBe(false);
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		const active = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(active);
		expect(active.defaultPrevented).toBe(true);
		unmount();
		await act(async () => {});
		const departed = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(departed);
		window.dispatchEvent(new Event("pagehide"));
		expect(departed.defaultPrevented).toBe(false);
		expect(fixture.commands.stop).toHaveBeenCalledTimes(1);
	});
	it("rejects stale targets and competing commands, then finishes one stop across navigation", async () => {
		const fixture = makeRecordingAdapters();
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		await act(async () => {
			await expect(
				result.current.run({
					kind: "stop",
					broadcastId: testId("broadcasts", "stale-broadcast"),
				}),
			).rejects.toBeInstanceOf(BroadcastCommandError);
		});
		expect(fixture.mediaReleased()).toBe(false);
		expect(onError).toHaveBeenCalledTimes(1);
		onError.mockClear();
		const accepting = deferred<void>();
		fixture.commands.acceptCommit.mockImplementationOnce(() =>
			accepting.promise.then(() => fixture.receipt),
		);
		act(() => fixture.caption("Accepted before stop"));
		await act(async () => {});
		let stopping!: ReturnType<typeof result.current.run>;
		act(() => {
			stopping = result.current.run({ kind: "stop", broadcastId });
		});
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {
			await expect(
				result.current.run({ kind: "start" }),
			).rejects.toBeInstanceOf(BroadcastCommandConflict);
		});
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			"Another Broadcast command is already running",
		);
		act(() => {
			window.dispatchEvent(new Event("pagehide"));
			window.dispatchEvent(new Event("pagehide"));
		});
		unmount();
		await act(async () => {
			accepting.resolve();
			await stopping;
		});
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
	});
	it.each([
		"accepted",
		"discarded then rejected",
	])("reconciles %s outstanding text after a real remount", async (settlement) => {
		const fixture = makeRecordingAdapters();
		const accepting = deferred<void>();
		fixture.commands.acceptCommit.mockImplementationOnce(() =>
			accepting.promise.then(() => fixture.receipt),
		);

		const current = createRef<ReturnType<typeof useBroadcastRecording>>();

		function Probe() {
			current.current = useBroadcastRecording({ sessionId, deviceId: "mic" });

			return null;
		}

		const recording = () => {
			if (!current.current) throw new Error("Recording hook has not mounted");

			return current.current;
		};

		const { rerender, unmount } = render(<Probe key="first" />, {
			wrapper: fixture.Wrapper,
		});

		await act(async () => {
			await recording().run({ kind: "start" });
		});
		act(() => fixture.caption("Outstanding remount text"));
		await act(async () => {});
		rerender(<Probe key="second" />);
		expect(fixture.mediaReleased()).toBe(true);
		expect(recording().activeBroadcastId).toBeNull();
		expect(recording().rejectedCaptures).toMatchObject([
			{ sourceText: "Outstanding remount text" },
		]);

		if (settlement === "discarded then rejected")
			act(() => recording().clearRejectedCaptures());
		await act(async () => {
			if (settlement === "accepted") accepting.resolve();
			else accepting.reject(new ConvexError({ message: "Acceptance refused" }));
		});
		expect(recording().rejectedCaptures).toEqual([]);
		expect(recording().activeBroadcastId).toBeNull();
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		unmount();
	});
	it("does not finalize a normal stop without disconnect acknowledgement", async () => {
		vi.useFakeTimers();
		const fixture = makeRecordingAdapters();
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		fixture.setAcknowledgeDisconnect(false);
		let stopping!: ReturnType<typeof result.current.run>;
		act(() => {
			stopping = result.current.run({ kind: "stop", broadcastId });
		});
		const outcome = stopping.catch((cause) => cause);
		expect(fixture.mediaReleased()).toBe(true);
		unmount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
			await expect(outcome).resolves.toBeInstanceOf(DisconnectTimeout);
		});
		expect(fixture.commands.stop).not.toHaveBeenCalled();
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(1);
	});
	it("stops late activation after departure without reviving recording or heartbeat", async () => {
		const fixture = makeRecordingAdapters();

		const activated =
			deferred<Awaited<ReturnType<BroadcastCommands["start"]>>>();

		fixture.commands.start.mockImplementationOnce(() => activated.promise);
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		let starting!: ReturnType<typeof result.current.run>;
		act(() => {
			starting = result.current.run({ kind: "start" });
		});
		await act(async () => {});
		unmount();
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {
			activated.resolve({
				broadcastId,
				sequence: 1,
				lastCommitOrdinal: 0,
				status: "active",
			});
			await starting;
		});
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(fixture.commands.heartbeat).not.toHaveBeenCalled();
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
		expect(result.current.activeBroadcastId).toBeNull();
		expect(onError).not.toHaveBeenCalled();
	});
	it("does not open media or activate after departure during token acquisition", async () => {
		const fixture = makeRecordingAdapters();
		const token = deferred<{ token: string }>();
		fixture.commands.getScribeToken.mockImplementationOnce(() => token.promise);
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		let starting!: ReturnType<typeof result.current.run>;
		act(() => {
			starting = result.current.run({ kind: "start" });
		});
		const outcome = starting.catch((cause) => cause);
		await act(async () => {});
		window.dispatchEvent(new Event("pagehide"));
		unmount();
		await act(async () => {
			token.resolve({ token: "test-token" });
			await outcome;
		});
		expect(fixture.scribe.connect).not.toHaveBeenCalled();
		expect(fixture.commands.start).not.toHaveBeenCalled();
		expect(fixture.commands.heartbeat).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledTimes(1);
	});
	it("chooses recovery intent when start is admitted, before token acquisition", async () => {
		const fixture = makeRecordingAdapters();
		const token = deferred<{ token: string }>();
		fixture.commands.getScribeToken.mockImplementationOnce(() => token.promise);
		const { result, rerender, unmount } = mountRecording(fixture);
		let starting!: ReturnType<typeof result.current.run>;
		act(() => {
			starting = result.current.run({ kind: "start" });
		});
		await act(async () => {});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: testId("broadcasts", "later-lost-broadcast"),
		});
		await act(async () => {
			token.resolve({ token: "test-token" });
			await starting;
		});
		expect(fixture.commands.start).toHaveBeenCalledExactlyOnceWith({
			sessionId,
		});
		expect(fixture.commands.resume).not.toHaveBeenCalled();
		unmount();
	});
	it("releases media on rejected abandonment and permits a deliberate retry", async () => {
		const fixture = makeRecordingAdapters();

		const abandoned =
			deferred<Awaited<ReturnType<BroadcastCommands["abandon"]>>>();

		fixture.commands.abandon.mockImplementationOnce(() => abandoned.promise);
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		expect(fixture.commands.resume).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		fixture.setClosingCaption("Retain rejected abandonment text");
		let abandoning!: ReturnType<typeof result.current.run>;
		act(() => {
			abandoning = result.current.run({ kind: "abandon", broadcastId });
		});
		const outcome = abandoning.catch((cause) => cause);
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {
			abandoned.reject(
				new ConvexError({ message: "Server refused abandonment" }),
			);
			await expect(outcome).resolves.toBeInstanceOf(BroadcastCommandError);
		});
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			"Server refused abandonment",
		);
		expect(result.current.rejectedCaptures).toMatchObject([
			{ sourceText: "Retain rejected abandonment text" },
		]);
		expect(fixture.commands.acceptCommit).not.toHaveBeenCalled();
		expect(fixture.commands.stop).not.toHaveBeenCalled();
		await act(async () => {
			await expect(
				result.current.run({ kind: "abandon", broadcastId }),
			).resolves.toMatchObject({ kind: "abandon", broadcastId });
		});
		expect(fixture.commands.abandon).toHaveBeenCalledTimes(2);
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
		unmount();
	});
	it("detaches the old Session while outstanding acceptance settles", async () => {
		const fixture = makeRecordingAdapters();
		const accepting = deferred<void>();
		fixture.commands.acceptCommit.mockImplementationOnce(() =>
			accepting.promise.then(() => fixture.receipt),
		);
		const { result, rerender, unmount } = mountRecording(fixture);
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		act(() => fixture.caption("Old Session text"));
		await act(async () => {});
		const nextSessionId = testId("sessions", "next-recording-session");
		rerender({ sessionId: nextSessionId, deviceId: "mic" });
		expect(fixture.mediaReleased()).toBe(true);
		expect(result.current.activeBroadcastId).toBeNull();
		expect(result.current.rejectedCaptures).toEqual([]);
		await act(async () => {
			accepting.resolve();
		});
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(result.current.activeBroadcastId).toBeNull();
		rerender({ sessionId, deviceId: "mic" });
		expect(result.current.rejectedCaptures).toEqual([]);
		unmount();
	});
	it("ignores callbacks from an abandoned connection after a later start", async () => {
		const fixture = makeRecordingAdapters();
		const { result, rerender, unmount } = mountRecording(fixture);
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		const previous = fixture.connectionCallbacks();
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
		});
		await act(async () => {
			await result.current.run({ kind: "abandon", broadcastId });
		});
		expect(fixture.handlersAttached()).toBe(false);
		rerender({ sessionId, deviceId: "mic", recoverableBroadcastId: null });
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		act(() => {
			previous.onCommittedTranscriptWithTimestamps?.({
				text: "Old connection text",
				words: [],
			});
			previous.onDisconnect?.();
			fixture.caption("Current connection text");
		});
		await act(async () => {});
		expect(fixture.commands.acceptCommit).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ sourceText: "Current connection text" }),
		);
		expect(fixture.commands.stop).not.toHaveBeenCalled();
		unmount();
	});
	it("keeps the admitted abandonment target while subscriptions change", async () => {
		const fixture = makeRecordingAdapters();
		const accepting = deferred<void>();
		fixture.commands.acceptCommit.mockImplementationOnce(() =>
			accepting.promise.then(() => fixture.receipt),
		);
		const onError = vi.fn();

		const { result, rerender, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		act(() => fixture.caption("Pending acceptance"));
		await act(async () => {});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
			onError,
		});
		let abandoning!: ReturnType<typeof result.current.run>;
		act(() => {
			abandoning = result.current.run({ kind: "abandon", broadcastId });
		});
		const outcome = abandoning.catch((cause) => cause);
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: testId("broadcasts", "another-lost-broadcast"),
			onError,
		});
		await act(async () => {
			accepting.resolve();
			await expect(outcome).resolves.toMatchObject({
				kind: "abandon",
				broadcastId,
			});
		});
		expect(fixture.commands.abandon).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
		expect(onError).not.toHaveBeenCalled();
		unmount();
	});
	it("leaves a late activation unresolved when navigation cannot acknowledge disconnect", async () => {
		vi.useFakeTimers();
		const fixture = makeRecordingAdapters();

		const activated =
			deferred<Awaited<ReturnType<BroadcastCommands["start"]>>>();

		fixture.commands.start.mockImplementationOnce(() => activated.promise);
		const onError = vi.fn();

		const { result, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		let starting!: ReturnType<typeof result.current.run>;
		act(() => {
			starting = result.current.run({ kind: "start" });
		});
		const outcome = starting.catch((cause) => cause);
		await act(async () => {});
		fixture.setAcknowledgeDisconnect(false);
		act(() => fixture.error());
		unmount();
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {
			activated.resolve({
				broadcastId,
				sequence: 1,
				lastCommitOrdinal: 0,
				status: "active",
			});
			await vi.advanceTimersByTimeAsync(2_000);
			await outcome;
		});
		expect(fixture.commands.stop).not.toHaveBeenCalled();
		expect(fixture.commands.heartbeat).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			"Timed out waiting for the transcription connection to close",
		);
	});

	it("reports a close timeout once while keeping server-accepted abandonment successful", async () => {
		vi.useFakeTimers();
		const fixture = makeRecordingAdapters();
		const onError = vi.fn();

		const { result, rerender, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
			onError,
		});
		fixture.setAcknowledgeDisconnect(false);
		fixture.setClosingCaption("Recoverable closing text");
		let abandoning!: ReturnType<typeof result.current.run>;
		act(() => {
			abandoning = result.current.run({ kind: "abandon", broadcastId });
		});
		expect(fixture.mediaReleased()).toBe(true);
		expect(fixture.handlersAttached()).toBe(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
			await expect(abandoning).resolves.toMatchObject({
				kind: "abandon",
				broadcastId,
			});
		});
		expect(result.current.rejectedCaptures).toMatchObject([
			{ sourceText: "Recoverable closing text" },
		]);
		expect(fixture.handlersAttached()).toBe(true);
		act(() => fixture.caption("Text after the timeout"));
		expect(result.current.rejectedCaptures).toHaveLength(1);
		act(() => fixture.connectionCallbacks().onDisconnect?.());
		expect(fixture.handlersAttached()).toBe(false);
		unmount();
		await act(async () => {});
		expect(onError).toHaveBeenCalledExactlyOnceWith(
			"Timed out waiting for the transcription connection to close",
		);
		expect(fixture.commands.stop).not.toHaveBeenCalled();
	});

	it("does not repeat a shared close timeout when retrying rejected abandonment", async () => {
		vi.useFakeTimers();
		const fixture = makeRecordingAdapters();
		const onError = vi.fn();
		fixture.commands.abandon.mockRejectedValueOnce(
			new ConvexError({ message: "Server refused abandonment" }),
		);

		const { result, rerender, unmount } = mountRecording(fixture, {
			sessionId,
			deviceId: "mic",
			onError,
		});

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
			onError,
		});
		fixture.setAcknowledgeDisconnect(false);
		let abandoning!: ReturnType<typeof result.current.run>;
		act(() => {
			abandoning = result.current.run({ kind: "abandon", broadcastId });
		});
		const outcome = abandoning.catch((cause) => cause);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
			await expect(outcome).resolves.toBeInstanceOf(BroadcastCommandError);
		});
		expect(onError.mock.calls).toEqual([
			["Timed out waiting for the transcription connection to close"],
			["Server refused abandonment"],
		]);
		await act(async () => {
			await expect(
				result.current.run({ kind: "abandon", broadcastId }),
			).resolves.toMatchObject({ kind: "abandon", broadcastId });
		});
		unmount();
		await act(async () => {});
		expect(fixture.scribe.disconnect).toHaveBeenCalledTimes(1);
		expect(fixture.commands.abandon).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenCalledTimes(2);
	});

	it("stops accepting new text as soon as abandonment begins, even with acceptance outstanding", async () => {
		const fixture = makeRecordingAdapters();
		const accepting = deferred<void>();
		fixture.commands.acceptCommit.mockImplementationOnce(() =>
			accepting.promise.then(() => fixture.receipt),
		);
		const { result, rerender, unmount } = mountRecording(fixture);
		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		act(() => fixture.caption("Already submitted"));
		await act(async () => {});
		rerender({
			sessionId,
			deviceId: "mic",
			recoverableBroadcastId: broadcastId,
		});
		fixture.setClosingCaption("Keep these closing words");
		let abandoning!: ReturnType<typeof result.current.run>;
		act(() => {
			abandoning = result.current.run({ kind: "abandon", broadcastId });
		});
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {
			accepting.resolve();
			await abandoning;
		});
		expect(fixture.commands.acceptCommit).toHaveBeenCalledTimes(1);
		expect(result.current.rejectedCaptures).toMatchObject([
			{ sourceText: "Keep these closing words" },
		]);
		unmount();
	});

	it("drains the finalized caption delivered while navigation releases the microphone", async () => {
		const fixture = makeRecordingAdapters();

		const { result, unmount } = renderHook(
			() => useBroadcastRecording({ sessionId, deviceId: "mic" }),
			{ wrapper: fixture.Wrapper },
		);

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		fixture.setClosingCaption("Final words before leaving");
		unmount();
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {});
		expect(fixture.commands.acceptCommit).toHaveBeenCalledWith(
			expect.objectContaining({ sourceText: "Final words before leaving" }),
		);
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
	});

	it("accepts captions and owns one heartbeat after a Strict Mode remount", async () => {
		vi.useFakeTimers();
		const fixture = makeRecordingAdapters();

		const { result, unmount } = renderHook(
			() => useBroadcastRecording({ sessionId, deviceId: "mic" }),
			{ wrapper: fixture.Wrapper },
		);

		await act(async () => {
			await result.current.run({ kind: "start" });
		});
		expect(fixture.mediaReleased()).toBe(false);
		act(() => fixture.caption("Hello audience"));
		await act(async () => {});
		expect(fixture.commands.acceptCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				broadcastId,
				sourceText: "Hello audience",
				commitOrdinal: 1,
			}),
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5_000);
		});
		expect(fixture.commands.heartbeat).toHaveBeenCalledTimes(2);
		unmount();
		expect(fixture.mediaReleased()).toBe(true);
		await act(async () => {});
		expect(fixture.commands.stop).toHaveBeenCalledExactlyOnceWith({
			broadcastId,
		});
	});
});
