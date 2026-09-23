// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useRealtimeConnection } from "@/hooks/use-realtime-connection";
import { testId } from "@/test/ids";

describe("useRealtimeConnection callback identity", () => {
	it("keeps connection controls stable across parent rerenders", () => {
		const scribe = {
			status: "disconnected" as const,
			partialTranscript: "",
			isConnected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			getConnection: vi.fn(() => null),
			clearTranscripts: vi.fn(),
		};

		const getScribeToken = vi.fn(async () => ({ token: "test-token" }));
		const registerHandlers = () => {};

		const { result, rerender } = renderHook(() =>
			useRealtimeConnection({
				sessionId: testId("sessions", "session-1"),
				deviceId: "microphone-1",
				onCommit: () => {},
				onError: () => {},
				getScribeToken,
				scribe,
				registerHandlers,
			}),
		);

		const firstConnect = result.current.connect;
		const firstDisconnect = result.current.disconnect;

		rerender();

		expect(result.current.connect).toBe(firstConnect);
		expect(result.current.disconnect).toBe(firstDisconnect);
	});

	it("connects after the development remount", async () => {
		let onConnect = () => {};

		const scribe = {
			status: "disconnected" as const,
			partialTranscript: "",
			isConnected: false,
			connect: vi.fn(async () => {
				onConnect();
			}),
			disconnect: vi.fn(),
			getConnection: vi.fn(() => null),
			clearTranscripts: vi.fn(),
		};

		const getScribeToken = vi.fn(async () => ({ token: "test-token" }));

		const { result } = renderHook(
			() =>
				useRealtimeConnection({
					sessionId: testId("sessions", "session-1"),
					deviceId: "microphone-1",
					getScribeToken,
					scribe,
					registerHandlers: (handlers) => {
						onConnect = handlers.onConnect;
					},
				}),
			{ wrapper: StrictMode },
		);

		await expect(result.current.connect()).resolves.toBe(1);
		expect(getScribeToken).toHaveBeenCalledOnce();
		expect(scribe.connect).toHaveBeenCalledOnce();
	});
});
