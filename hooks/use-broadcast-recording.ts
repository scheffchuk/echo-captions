"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CaptureEvent } from "@/hooks/broadcast-capture";
import {
	type BroadcastCoordinatorSnapshot,
	type BroadcastLifecycleStatus,
	createBroadcastCoordinator,
} from "@/hooks/broadcast-coordinator";
import { useRealtimeConnection } from "@/hooks/use-realtime-connection";

export type BroadcastVoiceState = "idle" | "connecting" | "recording";
export type { BroadcastLifecycleStatus } from "@/hooks/broadcast-coordinator";

const emptyCoordinatorSnapshot: BroadcastCoordinatorSnapshot = {
	activeBroadcastId: null,
	optimisticCaptures: [],
	rejectedCaptures: [],
	commandResult: { waiting: false, error: null },
};

export function useBroadcastRecording({
	sessionId,
	deviceId,
	broadcastStatus,
	recoverableBroadcastId,
	onError,
}: {
	sessionId: Id<"sessions"> | undefined;
	deviceId: string;
	broadcastStatus?: BroadcastLifecycleStatus;
	recoverableBroadcastId?: Id<"broadcasts"> | null;
	onError?: (message: string) => void;
}) {
	const startBroadcast = useMutation(api.broadcasts.start);
	const resumeBroadcast = useMutation(api.broadcasts.resume);
	const heartbeat = useMutation(api.broadcasts.heartbeat);
	const stopBroadcast = useMutation(api.broadcasts.stop);
	const acceptCommit = useMutation(api.captions.acceptCommit);

	const [coordinatorSnapshot, setCoordinatorSnapshot] = useState(
		emptyCoordinatorSnapshot,
	);
	const [coordinator] = useState(() =>
		createBroadcastCoordinator({ onSnapshot: setCoordinatorSnapshot }),
	);

	const offerCapture = useCallback(
		(event: CaptureEvent) => coordinator.offerCapture(event),
		[coordinator],
	);
	const realtime = useRealtimeConnection({
		sessionId,
		deviceId,
		onCommit: offerCapture,
		onError: coordinator.handleRealtimeError,
	});

	useEffect(() => {
		coordinator.update({
			sessionId,
			recoverableBroadcastId,
			onError,
			adapters: {
				connect: realtime.connect,
				disconnect: realtime.disconnect,
				start: (nextSessionId) =>
					startBroadcast({ sessionId: nextSessionId as Id<"sessions"> }),
				resume: (broadcastId) =>
					resumeBroadcast({ broadcastId: broadcastId as Id<"broadcasts"> }),
				heartbeat: async (broadcastId) => {
					await heartbeat({ broadcastId: broadcastId as Id<"broadcasts"> });
				},
				stop: ({ broadcastId }) =>
					stopBroadcast({ broadcastId: broadcastId as Id<"broadcasts"> }),
				acceptCommit: (args) =>
					acceptCommit({
						sessionId: args.sessionId as Id<"sessions">,
						broadcastId: args.broadcastId as Id<"broadcasts">,
						commitOrdinal: args.commitOrdinal,
						commitId: args.commitId,
						sourceText: args.sourceText,
						sourceLanguage: args.sourceLanguage,
					}),
			},
		});
	}, [
		acceptCommit,
		coordinator,
		heartbeat,
		onError,
		recoverableBroadcastId,
		realtime.connect,
		realtime.disconnect,
		resumeBroadcast,
		sessionId,
		startBroadcast,
		stopBroadcast,
	]);

	useEffect(() => {
		window.addEventListener("pagehide", coordinator.handlePagehide);
		return () =>
			window.removeEventListener("pagehide", coordinator.handlePagehide);
	}, [coordinator]);

	useEffect(() => () => coordinator.dispose(), [coordinator]);

	const toggleRecording = useCallback(() => {
		const shouldStart = broadcastStatus === "lost";
		const shouldStop =
			!shouldStart &&
			(realtime.isConnected ||
				coordinator.snapshot().activeBroadcastId !== null);
		return coordinator.run({ kind: shouldStop ? "stop" : "start" });
	}, [broadcastStatus, coordinator, realtime.isConnected]);

	const abandonRecording = useCallback(
		() => coordinator.abandon(),
		[coordinator],
	);
	const clearRejectedCaptures = useCallback(
		() => coordinator.clearRejectedCaptures(),
		[coordinator],
	);

	const voiceState: BroadcastVoiceState =
		realtime.status === "connecting" ||
		coordinatorSnapshot.commandResult.waiting
			? "connecting"
			: realtime.isConnected
				? "recording"
				: "idle";

	return {
		isConnected: realtime.isConnected,
		voiceState,
		partialText: realtime.partialTranscript,
		toggleRecording,
		abandonRecording,
		commandResult: coordinatorSnapshot.commandResult,
		optimisticCaptures: coordinatorSnapshot.optimisticCaptures,
		rejectedCaptures: coordinatorSnapshot.rejectedCaptures,
		clearRejectedCaptures,
	};
}
