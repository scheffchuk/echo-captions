import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useBroadcastAdapters } from "@/hooks/broadcast-adapters";
import {
	type BroadcastCoordinatorSnapshot,
	createBroadcastCoordinator,
} from "@/hooks/broadcast-coordinator";
import {
	type BroadcastCommand,
	BroadcastCommandError,
} from "@/hooks/broadcast-model";
import { useRejectedCaptureOwner } from "@/hooks/rejected-capture-owner";
import { useLiveRealtimeConnection } from "@/hooks/use-realtime-connection";

export type BroadcastVoiceState = "idle" | "connecting" | "recording";

export type { BroadcastLifecycleStatus } from "@/hooks/broadcast-coordinator";

const emptyCoordinatorSnapshot: BroadcastCoordinatorSnapshot = {
	activeBroadcastId: null,
	optimisticCaptures: [],
	rejectedCaptures: [],
	commandResult: { waiting: false, kind: null, error: null },
};

export function useBroadcastRecording({
	sessionId,
	deviceId,
	recoverableBroadcastId,
	onError,
}: {
	sessionId: Id<"sessions"> | undefined;
	deviceId: string;
	recoverableBroadcastId?: Id<"broadcasts"> | null;
	onError?: (message: string) => void;
}) {
	const rejectedCaptureOwner = useRejectedCaptureOwner();
	const { useCommands } = useBroadcastAdapters();

	const {
		start,
		resume,
		stop,
		abandon,
		heartbeat,
		acceptCommit,
		getScribeToken,
	} = useCommands();

	const [snapshot, setSnapshot] = useState(emptyCoordinatorSnapshot);

	const coordinatorRef = useRef<ReturnType<
		typeof createBroadcastCoordinator
	> | null>(null);

	const realtime = useLiveRealtimeConnection({
		sessionId,
		deviceId,
		getScribeToken,
	});

	const bindings = useMemo(
		() => ({
			sessionId,
			recoverableBroadcastId,
			onError,
			adapters: {
				connect: realtime.connect,
				disconnect: realtime.disconnect,
				start: (nextSessionId: Id<"sessions">) =>
					start({ sessionId: nextSessionId }),
				resume: (broadcastId: Id<"broadcasts">) => resume({ broadcastId }),
				stop,
				abandon,
				heartbeat: async (broadcastId: Id<"broadcasts">) => {
					await heartbeat({ broadcastId });
				},
				acceptCommit: async (args: Parameters<typeof acceptCommit>[0]) => {
					await acceptCommit(args);
				},
			},
		}),
		[
			sessionId,
			recoverableBroadcastId,
			onError,
			realtime.connect,
			realtime.disconnect,
			start,
			resume,
			stop,
			abandon,
			heartbeat,
			acceptCommit,
		],
	);

	const bindingsRef = useRef(bindings);
	bindingsRef.current = bindings;

	const updateBindings = useCallback(
		(
			coordinator: ReturnType<typeof createBroadcastCoordinator>,
			current: typeof bindings,
		) => {
			coordinator.update({
				...current,
				adapters: {
					...current.adapters,
					connect: () =>
						current.adapters.connect({
							onCommit: coordinator.offerCapture,
							onError: coordinator.handleRealtimeError,
						}),
				},
			});
		},
		[],
	);

	useEffect(() => {
		const coordinator = createBroadcastCoordinator({
			onSnapshot: setSnapshot,
			rejectedCaptureOwner,
		});

		coordinatorRef.current = coordinator;
		updateBindings(coordinator, { ...bindingsRef.current, sessionId });
		const onPagehide = () => coordinator.handlePagehide();

		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			const state = coordinator.snapshot();

			if (!state.activeBroadcastId && !state.commandResult.waiting) return;
			event.preventDefault();
			event.returnValue = "";
		};

		window.addEventListener("pagehide", onPagehide);
		window.addEventListener("beforeunload", onBeforeUnload);

		return () => {
			window.removeEventListener("pagehide", onPagehide);
			window.removeEventListener("beforeunload", onBeforeUnload);
			coordinator.dispose();
		};
	}, [rejectedCaptureOwner, sessionId, updateBindings]);

	useEffect(() => {
		if (coordinatorRef.current)
			updateBindings(coordinatorRef.current, bindings);
	}, [bindings, updateBindings]);

	const run = useCallback((command: BroadcastCommand) => {
		if (!coordinatorRef.current)
			return Promise.reject(
				new BroadcastCommandError({ message: "Broadcast is not ready" }),
			);

		return coordinatorRef.current.run(command);
	}, []);

	const clearRejectedCaptures = useCallback(
		() => coordinatorRef.current?.clearRejectedCaptures(),
		[],
	);

	const voiceState: BroadcastVoiceState =
		realtime.status === "connecting" || snapshot.commandResult.waiting
			? "connecting"
			: realtime.isConnected
				? "recording"
				: "idle";

	return {
		run,
		pendingCommand: snapshot.commandResult.kind,
		activeBroadcastId: snapshot.activeBroadcastId,
		isConnected: realtime.isConnected,
		voiceState,
		partialText: realtime.partialTranscript,
		optimisticCaptures: snapshot.optimisticCaptures,
		rejectedCaptures: snapshot.rejectedCaptures,
		clearRejectedCaptures,
	};
}
