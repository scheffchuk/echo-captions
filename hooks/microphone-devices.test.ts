// @vitest-environment jsdom

import { Deferred, Effect, Fiber, Queue, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AudioDevice,
	classifyMicrophoneError,
	createMicrophoneDeviceStream,
	enumerateAudioDevices,
	MicrophonePermissionDenied,
	type MicrophoneStream,
	requestMicrophonePermission,
} from "@/hooks/microphone-devices";

function device(
	kind: MediaDeviceKind,
	deviceId: string,
	label: string,
): MediaDeviceInfo {
	return {
		deviceId,
		groupId: "group-1",
		kind,
		label,
		toJSON: () => ({}),
	};
}

function createSource(initialDevices: readonly MediaDeviceInfo[] = []) {
	let devices = initialDevices;
	let deviceChangeListener: (() => void) | undefined;
	const track = { stop: vi.fn() };
	const secondTrack = { stop: vi.fn() };

	const stream: MicrophoneStream = {
		getTracks: () => [track, secondTrack],
	};

	const enumerateDevices = vi.fn(async () => devices);
	const getUserMedia = vi.fn(async () => stream);

	const source = {
		enumerateDevices,
		getUserMedia,
		addEventListener: vi.fn((_type, listener) => {
			deviceChangeListener = listener;
		}),
		removeEventListener: vi.fn((_type, listener) => {
			if (deviceChangeListener === listener) deviceChangeListener = undefined;
		}),
		track,
		secondTrack,
		stream,
		setDevices: (next: readonly MediaDeviceInfo[]) => {
			devices = next;
		},
		emitDeviceChange: () => deviceChangeListener?.(),
	};

	return source;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("microphone device effects", () => {
	it("enumerates selectable audio inputs and preserves browser-specific labels", async () => {
		const source = createSource([
			device("audioinput", "mic-1", "Desk Mic (Default)"),
			device("videoinput", "camera-1", "Camera"),
			device("audioinput", "", "Hidden until permission"),
		]);

		const devices = await Effect.runPromise(enumerateAudioDevices(source));

		expect(devices).toEqual<readonly AudioDevice[]>([
			{ deviceId: "mic-1", groupId: "group-1", label: "Desk Mic" },
		]);
	});

	it("stops every temporary permission track after a successful acquisition", async () => {
		const source = createSource();

		await Effect.runPromise(requestMicrophonePermission(source));

		expect(source.getUserMedia).toHaveBeenCalledWith({ audio: true });
		expect(source.track.stop).toHaveBeenCalledTimes(1);
		expect(source.secondTrack.stop).toHaveBeenCalledTimes(1);
	});

	it("returns a typed error for permission denial", async () => {
		const source = createSource();
		source.getUserMedia.mockRejectedValueOnce(
			new DOMException("Permission denied", "NotAllowedError"),
		);

		await expect(
			Effect.runPromise(requestMicrophonePermission(source)),
		).rejects.toBeInstanceOf(MicrophonePermissionDenied);
	});

	it("preserves unknown connection defects", () => {
		const defect = new Error("browser exploded");
		expect(() => classifyMicrophoneError(defect)).toThrow(defect);
	});

	it("stops a permission stream when enumeration fails after acquisition", async () => {
		const source = createSource();
		source.enumerateDevices.mockRejectedValueOnce(
			new DOMException("The document is not allowed", "SecurityError"),
		);

		await expect(
			Effect.runPromise(requestMicrophonePermission(source)),
		).rejects.toBeInstanceOf(MicrophonePermissionDenied);
		expect(source.track.stop).toHaveBeenCalledTimes(1);
		expect(source.secondTrack.stop).toHaveBeenCalledTimes(1);
	});

	it("stops a late stream when permission acquisition is interrupted", async () => {
		const acquisitionStarted = Effect.runSync(Deferred.make<void>());
		const streamStopped = Effect.runSync(Deferred.make<void>());
		let resolveStream!: (stream: MicrophoneStream) => void;
		const source = createSource();
		source.track.stop.mockImplementation(() => {
			Effect.runSync(Deferred.succeed(streamStopped, undefined));
		});
		source.getUserMedia.mockImplementationOnce(
			() =>
				new Promise<MicrophoneStream>((resolve) => {
					Effect.runSync(Deferred.succeed(acquisitionStarted, undefined));
					resolveStream = resolve;
				}),
		);

		const fiber = Effect.runFork(requestMicrophonePermission(source));
		await Effect.runPromise(Deferred.await(acquisitionStarted));
		const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
		resolveStream(source.stream);
		await Effect.runPromise(Deferred.await(streamStopped));
		await interrupted;

		expect(source.track.stop).toHaveBeenCalledTimes(1);
		expect(source.secondTrack.stop).toHaveBeenCalledTimes(1);
	});

	it("keeps one device-change listener and releases it when the stream is interrupted", async () => {
		const source = createSource([device("audioinput", "mic-1", "Desk Mic")]);
		const snapshots = Effect.runSync(Queue.unbounded<readonly AudioDevice[]>());

		const fiber = Effect.runFork(
			createMicrophoneDeviceStream(source).pipe(
				Stream.runForEach((snapshot) =>
					snapshot.status === "ready"
						? Queue.offer(snapshots, snapshot.devices)
						: Effect.void,
				),
			),
		);

		const initialSnapshot = await Effect.runPromise(Queue.take(snapshots));
		expect(source.addEventListener).toHaveBeenCalledTimes(1);
		expect(initialSnapshot).toEqual([
			{ deviceId: "mic-1", groupId: "group-1", label: "Desk Mic" },
		]);

		source.setDevices([
			device("audioinput", "mic-1", "Desk Mic"),
			device("audioinput", "mic-2", "USB Mic"),
		]);
		source.emitDeviceChange();
		expect(await Effect.runPromise(Queue.take(snapshots))).toEqual([
			{ deviceId: "mic-1", groupId: "group-1", label: "Desk Mic" },
			{ deviceId: "mic-2", groupId: "group-1", label: "USB Mic" },
		]);

		await Effect.runPromise(Fiber.interrupt(fiber));
		expect(source.removeEventListener).toHaveBeenCalledTimes(1);
	});

	it("does not convert unknown browser failures into a fake device", async () => {
		const source = createSource();
		const failure = new Error("browser exploded");
		source.enumerateDevices.mockRejectedValueOnce(failure);

		await expect(Effect.runPromise(enumerateAudioDevices(source))).rejects.toBe(
			failure,
		);
	});
});
