// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveRealtimeConnection } from "@/hooks/use-realtime-connection";
import { testId } from "@/test/ids";

class ControlledWebSocket extends EventTarget {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static instances: ControlledWebSocket[] = [];
	readyState = ControlledWebSocket.CONNECTING;
	acknowledgeClose = true;
	constructor(_url: string) {
		super();
		ControlledWebSocket.instances.push(this);
	}
	send(_data: string) {}
	close() {
		this.readyState = ControlledWebSocket.CLOSING;

		if (this.acknowledgeClose) this.finishClose();
	}
	open() {
		this.readyState = ControlledWebSocket.OPEN;
		this.dispatchEvent(new Event("open"));
	}
	finishClose() {
		this.readyState = ControlledWebSocket.CLOSED;
		this.dispatchEvent(new CloseEvent("close", { code: 1000, wasClean: true }));
	}
}

class ControlledAudioNode {
	port = { onmessage: null, postMessage: () => {} };
	connect() {}
	disconnect() {}
}

class ControlledAudioContext {
	sampleRate = 16_000;
	state = "running";
	audioWorklet = { addModule: async () => {} };
	createMediaStreamSource() {
		return new ControlledAudioNode();
	}
	async close() {}
}

function microphone() {
	const stop = vi.fn();
	const track = { stop, getSettings: () => ({ sampleRate: 16_000 }) };

	return {
		stop,
		stream: { getAudioTracks: () => [track], getTracks: () => [track] },
	};
}

function deferred<A>() {
	let resolve!: (value: A) => void;

	const promise = new Promise<A>((res) => {
		resolve = res;
	});

	return { promise, resolve };
}

beforeEach(() => {
	ControlledWebSocket.instances = [];
	vi.stubGlobal("WebSocket", ControlledWebSocket);
	vi.stubGlobal("AudioContext", ControlledAudioContext);
	vi.stubGlobal("AudioWorkletNode", ControlledAudioNode);

	class ControlledURL extends URL {
		static createObjectURL() {
			return "blob:scribe-worklet";
		}
		static revokeObjectURL() {}
	}

	vi.stubGlobal("URL", ControlledURL);
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function mountNativeRealtime() {
	const getScribeToken = vi.fn(async () => ({ token: "test-token" }));

	return renderHook(() =>
		useLiveRealtimeConnection({
			sessionId: testId("sessions", "native-session"),
			deviceId: "mic",
			getScribeToken,
		}),
	);
}

async function openConnection(
	recording: ReturnType<typeof mountNativeRealtime>,
) {
	let connecting!: ReturnType<typeof recording.result.current.connect>;
	act(() => {
		connecting = recording.result.current.connect();
	});
	await act(async () => {});
	const socket = ControlledWebSocket.instances.at(-1);

	if (!socket) throw new Error("Native SDK did not create a socket");
	await act(async () => {
		socket.open();
		await connecting;
	});

	return socket;
}

describe("native Scribe recording lifetime", () => {
	it("waits for the old native close event before opening another connection after timeout", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("navigator", {
			mediaDevices: { getUserMedia: async () => microphone().stream },
		});
		const recording = mountNativeRealtime();
		const socket = await openConnection(recording);
		socket.acknowledgeClose = false;
		let disconnecting!: ReturnType<typeof recording.result.current.disconnect>;
		act(() => {
			disconnecting = recording.result.current.disconnect();
		});
		const closed = disconnecting.catch((cause) => cause);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
			await closed;
		});
		let reconnecting!: ReturnType<typeof recording.result.current.connect>;
		act(() => {
			reconnecting = recording.result.current.connect();
		});
		const retried = reconnecting.catch(() => false);
		await act(async () => {});
		expect(ControlledWebSocket.instances).toHaveLength(1);
		await expect(retried).resolves.toBe(false);
		act(() => socket.finishClose());
		await openConnection(recording);
		expect(ControlledWebSocket.instances).toHaveLength(2);
		recording.unmount();
	});
	it("releases microphone tracks acquired after the mounted owner departs", async () => {
		const acquired = deferred<ReturnType<typeof microphone>["stream"]>();
		const getUserMedia = vi.fn(() => acquired.promise);
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
		const recording = mountNativeRealtime();
		await openConnection(recording);
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		recording.unmount();
		const media = microphone();
		await act(async () => {
			acquired.resolve(media.stream);
		});
		expect(media.stop).toHaveBeenCalledTimes(1);
	});
});
