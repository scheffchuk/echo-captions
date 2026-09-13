// @vitest-environment jsdom

import { RegistryProvider } from "@effect/atom-react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicSelector, useAudioDevices } from "@/components/ui/mic-selector";
import type { MediaDevicesSource } from "@/hooks/microphone-devices";

function device(deviceId: string, label: string): MediaDeviceInfo {
	return {
		deviceId,
		groupId: "group-1",
		kind: "audioinput",
		label,
		toJSON: () => ({}),
	};
}

function createSource(initialDevices: readonly MediaDeviceInfo[] = []) {
	let devices = initialDevices;
	const listeners = new Set<() => void>();
	const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
	const secondTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
	const stream = {
		getTracks: () => [track, secondTrack],
	} as unknown as MediaStream;
	const source = {
		enumerateDevices: vi.fn(async () => devices),
		getUserMedia: vi.fn(async () => stream),
		addEventListener: vi.fn((_type: "devicechange", next: () => void) => {
			listeners.add(next);
		}),
		removeEventListener: vi.fn((_type: "devicechange", next: () => void) => {
			listeners.delete(next);
		}),
		setDevices(next: readonly MediaDeviceInfo[]) {
			devices = next;
		},
		emitDeviceChange() {
			for (const next of listeners) next();
		},
		get listenerCount() {
			return listeners.size;
		},
		track,
		secondTrack,
		stream,
	};
	return source as MediaDevicesSource & typeof source;
}

function installMediaDevices(source: MediaDevicesSource) {
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: source,
	});
}

function DeviceState({ onError }: { onError?: (message: string) => void }) {
	const state = useAudioDevices(onError);
	return (
		<div>
			<div data-testid="devices">
				{state.devices.map((item) => item.deviceId).join(",")}
			</div>
			<div data-testid="loading">{String(state.loading)}</div>
			<div data-testid="permission">{String(state.hasPermission)}</div>
			<div data-testid="error">{state.error ?? ""}</div>
			<button
				type="button"
				onClick={() => void state.requestMicrophoneAccess()}
			>
				Request microphone
			</button>
		</div>
	);
}

function renderWithRegistry(element: React.ReactNode) {
	return render(<RegistryProvider>{element}</RegistryProvider>);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("microphone selector", () => {
	it("enumerates initially, follows additions and removals, and releases its listener", async () => {
		const source = createSource([device("mic-1", "Desk Mic")]);
		installMediaDevices(source);
		const view = renderWithRegistry(<DeviceState />);

		await waitFor(() =>
			expect(screen.getByTestId("devices")).toHaveTextContent("mic-1"),
		);
		expect(source.addEventListener).toHaveBeenCalledTimes(1);
		expect(source.listenerCount).toBe(1);

		source.setDevices([
			device("mic-1", "Desk Mic"),
			device("mic-2", "USB Mic"),
		]);
		source.emitDeviceChange();
		await waitFor(() =>
			expect(screen.getByTestId("devices")).toHaveTextContent("mic-1,mic-2"),
		);

		source.setDevices([device("mic-2", "USB Mic")]);
		source.emitDeviceChange();
		await waitFor(() =>
			expect(screen.getByTestId("devices")).toHaveTextContent("mic-2"),
		);

		view.unmount();
		await waitFor(() =>
			expect(source.removeEventListener).toHaveBeenCalledTimes(1),
		);
	});

	it("surfaces an explicit permission denial and stops the temporary track", async () => {
		const source = createSource([device("mic-1", "Desk Mic")]);
		source.getUserMedia.mockRejectedValueOnce(
			new DOMException("Permission denied", "NotAllowedError"),
		);
		installMediaDevices(source);
		const onError = vi.fn();
		renderWithRegistry(<DeviceState onError={onError} />);

		await waitFor(() =>
			expect(screen.getByTestId("loading")).toHaveTextContent("false"),
		);
		await userEvent.click(screen.getByRole("button", { name: /request/i }));

		await waitFor(() => {
			expect(screen.getByTestId("permission")).toHaveTextContent("false");
			expect(screen.getByTestId("error")).toHaveTextContent(
				"Microphone permission was denied",
			);
			expect(source.track.stop).not.toHaveBeenCalled();
			expect(onError).toHaveBeenCalledWith(
				expect.stringContaining("Microphone permission was denied"),
			);
		});
	});

	it("grants permission once, stops the temporary track, and keeps one listener", async () => {
		const source = createSource([device("mic-1", "Desk Mic")]);
		installMediaDevices(source);
		renderWithRegistry(<DeviceState />);

		await waitFor(() =>
			expect(screen.getByTestId("loading")).toHaveTextContent("false"),
		);
		await userEvent.click(screen.getByRole("button", { name: /request/i }));

		await waitFor(() => {
			expect(screen.getByTestId("permission")).toHaveTextContent("true");
			expect(source.listenerCount).toBe(1);
			expect(source.track.stop).toHaveBeenCalledTimes(1);
			expect(source.secondTrack.stop).toHaveBeenCalledTimes(1);
		});
	});

	it("replaces a stale selection with the first currently available microphone", async () => {
		const source = createSource([device("mic-1", "Desk Mic")]);
		installMediaDevices(source);
		function ControlledSelector() {
			const [value, setValue] = useState("stale-mic");
			return (
				<>
					<MicSelector value={value} onValueChange={setValue} />
					<div data-testid="selected">{value}</div>
				</>
			);
		}

		renderWithRegistry(<ControlledSelector />);

		await waitFor(() =>
			expect(screen.getByTestId("selected")).toHaveTextContent("mic-1"),
		);
		expect(
			screen.getByRole("button", { name: "Microphone: Desk Mic" }),
		).toBeInTheDocument();

		source.setDevices([]);
		source.emitDeviceChange();
		await waitFor(() =>
			expect(screen.getByTestId("selected")).toHaveTextContent(""),
		);
	});

	it("stops a late permission stream when the selector unmounts", async () => {
		let resolveStream!: (stream: MediaStream) => void;
		const source = createSource([device("mic-1", "Desk Mic")]);
		source.getUserMedia.mockReturnValueOnce(
			new Promise<MediaStream>((resolve) => {
				resolveStream = resolve;
			}),
		);
		installMediaDevices(source);
		const view = renderWithRegistry(<DeviceState />);

		await waitFor(() =>
			expect(screen.getByTestId("loading")).toHaveTextContent("false"),
		);
		await userEvent.click(screen.getByRole("button", { name: /request/i }));
		await waitFor(() => expect(source.getUserMedia).toHaveBeenCalledTimes(1));

		view.unmount();
		resolveStream(source.stream);
		await waitFor(() => {
			expect(source.track.stop).toHaveBeenCalledTimes(1);
			expect(source.secondTrack.stop).toHaveBeenCalledTimes(1);
		});
	});
});
