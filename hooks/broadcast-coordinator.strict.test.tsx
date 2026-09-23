// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBroadcastCoordinator } from "@/hooks/broadcast-coordinator";
import { testId } from "@/test/ids";

describe("Broadcast coordinator development remount", () => {
	it("heartbeats after Strict Mode disposes and remounts the owner", async () => {
		let heartbeat!: () => void;
		const heartbeatAdapter = vi.fn(async () => undefined);

		const { result } = renderHook(
			() => {
				const [coordinator] = useState(() =>
					createBroadcastCoordinator({
						timers: {
							setInterval: (callback) => {
								heartbeat = callback;

								return 1;
							},
							clearInterval: () => {},
						},
					}),
				);

				useEffect(() => {
					coordinator.update({
						sessionId: testId("sessions", "session-strict"),
						recoverableBroadcastId: null,
						adapters: {
							connect: async () => 3,
							disconnect: async () => undefined,
							start: async () => ({
								broadcastId: testId("broadcasts", "broadcast-strict"),
								sequence: 4,
								lastCommitOrdinal: 0,
							}),
							resume: async () => ({
								broadcastId: testId("broadcasts", "broadcast-strict"),
								sequence: 4,
								lastCommitOrdinal: 0,
							}),
							heartbeat: heartbeatAdapter,
							stop: async () => ({ lastCommitOrdinal: 0 }),
							acceptCommit: async () => undefined,
						},
					});
				}, [coordinator]);

				useEffect(() => () => coordinator.dispose(), [coordinator]);

				return coordinator;
			},
			{ wrapper: StrictMode },
		);

		await result.current.run({ kind: "start" });

		expect(heartbeatAdapter).toHaveBeenCalledOnce();
		heartbeat();

		expect(heartbeatAdapter).toHaveBeenCalledTimes(2);
	});
});
