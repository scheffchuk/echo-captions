import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CaptureEvent } from "@/hooks/broadcast-capture";
import {
	type BroadcastActivation,
	type BroadcastCommitInput,
	type BroadcastCoordinatorAdapters,
	type BroadcastCoordinatorSnapshot,
	type BroadcastLifecycleStatus,
	createBroadcastCoordinator,
} from "@/hooks/broadcast-coordinator";
import { useRejectedCaptureOwner } from "@/hooks/rejected-capture-owner";
import { useLiveRealtimeConnection } from "@/hooks/use-realtime-connection";

export type BroadcastVoiceState = "idle" | "connecting" | "recording";

export type { BroadcastLifecycleStatus } from "@/hooks/broadcast-coordinator";

type BroadcastRecordingBindings<AcceptResult> = {
	sessionId: Id<"sessions"> | undefined;
	recoverableBroadcastId: Id<"broadcasts"> | null | undefined;
	onError: ((message: string) => void) | undefined;
	connect: BroadcastCoordinatorAdapters["connect"];
	disconnect: BroadcastCoordinatorAdapters["disconnect"];
	startBroadcast: (args: {
		sessionId: Id<"sessions">;
	}) => Promise<BroadcastActivation>;
	resumeBroadcast: (args: {
		broadcastId: Id<"broadcasts">;
	}) => Promise<BroadcastActivation>;
	heartbeat: (args: { broadcastId: Id<"broadcasts"> }) => Promise<null>;
	stopBroadcast: (args: {
		broadcastId: Id<"broadcasts">;
	}) => Promise<BroadcastActivation>;
	acceptCommit: (args: BroadcastCommitInput) => Promise<AcceptResult>;
};

function applyBroadcastRecording<AcceptResult>(
	coordinator: ReturnType<typeof createBroadcastCoordinator>,
	recording: BroadcastRecordingBindings<AcceptResult>,
) {
	coordinator.update({
		sessionId: recording.sessionId,
		recoverableBroadcastId: recording.recoverableBroadcastId,
		onError: recording.onError,
		adapters: {
			connect: recording.connect,
			disconnect: recording.disconnect,
			start: (nextSessionId) =>
				recording.startBroadcast({ sessionId: nextSessionId }),
			resume: (broadcastId) => recording.resumeBroadcast({ broadcastId }),
			heartbeat: async (broadcastId) => {
				await recording.heartbeat({ broadcastId });
			},
			stop: ({ broadcastId }) => recording.stopBroadcast({ broadcastId }),
			acceptCommit: async (args) => {
				await recording.acceptCommit({
					sessionId: args.sessionId,
					broadcastId: args.broadcastId,
					commitOrdinal: args.commitOrdinal,
					commitId: args.commitId,
					sourceText: args.sourceText,
					sourceLanguage: args.sourceLanguage,
				});
			},
		},
	});
}

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
	const rejectedCaptureOwner = useRejectedCaptureOwner();
	const startBroadcast = useMutation(api.broadcasts.start);
	const resumeBroadcast = useMutation(api.broadcasts.resume);
	const heartbeat = useMutation(api.broadcasts.heartbeat);
	const stopBroadcast = useMutation(api.broadcasts.stop);
	const acceptCommit = useMutation(api.captions.acceptCommit);

	const [coordinatorSnapshot, setCoordinatorSnapshot] = useState(
		emptyCoordinatorSnapshot,
	);

	const coordinatorRef = useRef<ReturnType<
		typeof createBroadcastCoordinator
	> | null>(null);

	const offerCapture = useCallback((event: CaptureEvent) => {
		coordinatorRef.current?.offerCapture(event);
	}, []);

	const reportRealtimeError = useCallback((message: string) => {
		coordinatorRef.current?.handleRealtimeError(message);
	}, []);

	const realtime = useLiveRealtimeConnection({
		sessionId,
		deviceId,
		onCommit: offerCapture,
		onError: reportRealtimeError,
	});

	const recordingRef = useRef({
		sessionId,
		recoverableBroadcastId,
		onError,
		connect: realtime.connect,
		disconnect: realtime.disconnect,
		startBroadcast,
		resumeBroadcast,
		heartbeat,
		stopBroadcast,
		acceptCommit,
	});

	recordingRef.current = {
		sessionId,
		recoverableBroadcastId,
		onError,
		connect: realtime.connect,
		disconnect: realtime.disconnect,
		startBroadcast,
		resumeBroadcast,
		heartbeat,
		stopBroadcast,
		acceptCommit,
	};

	useEffect(() => {
		const coordinator = createBroadcastCoordinator({
			onSnapshot: setCoordinatorSnapshot,
			rejectedCaptureOwner,
		});

		coordinatorRef.current = coordinator;
		applyBroadcastRecording(coordinator, recordingRef.current);

		return () => {
			coordinator.dispose();

			if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
		};
	}, [rejectedCaptureOwner]);

	useEffect(() => {
		const coordinator = coordinatorRef.current;

		if (!coordinator) return;

		applyBroadcastRecording(coordinator, {
			sessionId,
			recoverableBroadcastId,
			onError,
			connect: realtime.connect,
			disconnect: realtime.disconnect,
			startBroadcast,
			resumeBroadcast,
			heartbeat,
			stopBroadcast,
			acceptCommit,
		});
	}, [
		acceptCommit,
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
		const onPagehide = () => coordinatorRef.current?.handlePagehide();

		window.addEventListener("pagehide", onPagehide);

		return () => window.removeEventListener("pagehide", onPagehide);
	}, []);

	const toggleRecording = useCallback(() => {
		const coordinator = coordinatorRef.current;

		if (!coordinator) return Promise.resolve();

		const shouldStart = broadcastStatus === "lost";

		const shouldStop =
			!shouldStart &&
			(realtime.isConnected ||
				coordinator.snapshot().activeBroadcastId !== null);

		return coordinator.run({ kind: shouldStop ? "stop" : "start" });
	}, [broadcastStatus, realtime.isConnected]);

	const abandonRecording = useCallback(
		() => coordinatorRef.current?.abandon(),
		[],
	);

	const clearRejectedCaptures = useCallback(
		() => coordinatorRef.current?.clearRejectedCaptures(),
		[],
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
		optimisticCaptures: coordinatorSnapshot.optimisticCaptures,
		rejectedCaptures: coordinatorSnapshot.rejectedCaptures,
		clearRejectedCaptures,
	};
}
