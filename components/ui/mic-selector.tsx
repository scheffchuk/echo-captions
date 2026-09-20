"use client";

import { Cause, Effect, Exit, Option, Stream } from "effect";
import { Check, ChevronsUpDown, Mic } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	createMicrophoneDeviceStream,
	getBrowserMediaDevices,
	type MicrophoneDeviceSnapshot,
	type MicrophoneError,
	requestMicrophonePermission,
	unsupportedMicrophoneError,
} from "@/hooks/microphone-devices";
import { cn } from "@/lib/utils";

export function MicSelector({
	value,
	onValueChange,
	disabled,
	className,
	onError,
}: {
	value?: string;
	onValueChange?: (deviceId: string) => void;
	disabled?: boolean;
	className?: string;
	onError?: (message: string) => void;
}) {
	const { devices, loading, error, hasPermission, requestMicrophoneAccess } =
		useAudioDevices(onError);
	const [selectedDevice, setSelectedDevice] = useState(value || "");

	useEffect(() => {
		if (value !== undefined) setSelectedDevice(value);
	}, [value]);

	const defaultDeviceId = devices[0]?.deviceId || "";
	useEffect(() => {
		if (loading || error) return;
		const nextDeviceId = devices.some(
			(device) => device.deviceId === selectedDevice,
		)
			? selectedDevice
			: defaultDeviceId;
		if (nextDeviceId === selectedDevice) return;
		setSelectedDevice(nextDeviceId);
		onValueChange?.(nextDeviceId);
	}, [defaultDeviceId, devices, error, loading, onValueChange, selectedDevice]);

	const currentDevice = devices.find((d) => d.deviceId === selectedDevice) ||
		devices[0] || {
			label: loading
				? "Loading..."
				: error
					? "Microphone unavailable"
					: "No microphone",
			deviceId: "",
		};

	const handleDeviceSelect = (deviceId: string, e?: React.MouseEvent) => {
		e?.preventDefault();
		setSelectedDevice(deviceId);
		onValueChange?.(deviceId);
	};

	const handleDropdownOpenChange = async (open: boolean) => {
		if (open && !hasPermission && !loading) {
			await requestMicrophoneAccess();
		}
	};

	return (
		<DropdownMenu onOpenChange={handleDropdownOpenChange}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"hover:bg-accent flex w-auto shrink cursor-pointer items-center gap-1.5 px-2",
						className,
					)}
					disabled={loading || disabled}
					aria-label={`Microphone: ${currentDevice.label}`}
				>
					<Mic className="h-4 w-4 shrink-0" />
					<ChevronsUpDown className="h-3 w-3 shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="center" side="top" className="w-72">
				{loading ? (
					<DropdownMenuItem disabled>Loading devices...</DropdownMenuItem>
				) : error && !onError ? (
					<DropdownMenuItem disabled>{error}</DropdownMenuItem>
				) : devices.length === 0 ? (
					<DropdownMenuItem disabled>No microphones found</DropdownMenuItem>
				) : (
					devices.map((device) => (
						<DropdownMenuItem
							key={device.deviceId}
							onClick={(e) => handleDeviceSelect(device.deviceId, e)}
							onSelect={(e) => e.preventDefault()}
							className="flex items-center justify-between"
						>
							<span className="truncate">{device.label}</span>
							{selectedDevice === device.deviceId ? (
								<Check className="h-4 w-4 shrink-0" />
							) : null}
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function useAudioDevices(onError?: (message: string) => void) {
	const mediaDevices = useMemo(getBrowserMediaDevices, []);
	const unsupported = useMemo(unsupportedMicrophoneError, []);
	const [snapshot, setSnapshot] = useState<MicrophoneDeviceSnapshot>();
	const [permissionError, setPermissionError] =
		useState<MicrophoneError | null>(null);
	const [permissionWaiting, setPermissionWaiting] = useState(false);
	const [hasPermission, setHasPermission] = useState(false);
	const [fatalError, setFatalError] = useState<{ cause: unknown } | null>(null);
	const lifecycleGeneration = useRef(0);
	const permissionRequests = useRef(new Set<AbortController>());

	useEffect(() => {
		const streamController = new AbortController();
		lifecycleGeneration.current += 1;
		const deviceStream = mediaDevices
			? createMicrophoneDeviceStream(mediaDevices)
			: Stream.succeed<MicrophoneDeviceSnapshot>({
					status: "error",
					error: unsupported,
				});
		const consumeDevices = Stream.runForEach(deviceStream, (nextSnapshot) =>
			Effect.sync(() => {
				if (!streamController.signal.aborted) setSnapshot(nextSnapshot);
			}),
		);

		void Effect.runPromiseExit(consumeDevices, {
			signal: streamController.signal,
		}).then((exit) => {
			if (
				streamController.signal.aborted ||
				Exit.isSuccess(exit) ||
				Cause.hasInterruptsOnly(exit.cause)
			) {
				return;
			}
			setFatalError({ cause: Cause.squash(exit.cause) });
		});

		return () => {
			lifecycleGeneration.current += 1;
			streamController.abort();
			for (const controller of permissionRequests.current) controller.abort();
			permissionRequests.current.clear();
		};
	}, [mediaDevices, unsupported]);

	if (fatalError) throw fatalError.cause;

	const devices = snapshot?.status === "ready" ? snapshot.devices : [];
	const enumerationError =
		snapshot?.status === "error" ? snapshot.error : undefined;
	const typedError = permissionError ?? enumerationError ?? null;
	const error = typedError?.message ?? null;
	const loading = snapshot === undefined || permissionWaiting;

	useEffect(() => {
		if (typedError) onError?.(typedError.message);
	}, [onError, typedError]);

	const requestMicrophoneAccess = useCallback(async () => {
		const generation = lifecycleGeneration.current;
		const controller = new AbortController();
		permissionRequests.current.add(controller);
		setPermissionWaiting(true);
		setPermissionError(null);
		const request = mediaDevices
			? requestMicrophonePermission(mediaDevices)
			: Effect.fail(unsupported);
		const result = await Effect.runPromiseExit(request, {
			signal: controller.signal,
		});
		permissionRequests.current.delete(controller);

		if (
			controller.signal.aborted ||
			generation !== lifecycleGeneration.current
		) {
			return result;
		}

		setPermissionWaiting(false);
		if (Exit.isSuccess(result)) {
			setHasPermission(true);
			setSnapshot({ status: "ready", devices: result.value });
			return result;
		}

		const typedFailure = Option.getOrUndefined(
			Cause.findErrorOption(result.cause),
		);
		if (typedFailure !== undefined) {
			setHasPermission(false);
			setPermissionError(typedFailure);
		} else if (!Cause.hasInterruptsOnly(result.cause)) {
			setFatalError({ cause: Cause.squash(result.cause) });
		}
		return result;
	}, [mediaDevices, unsupported]);

	return {
		devices,
		loading,
		error,
		errorCause: typedError,
		hasPermission,
		requestMicrophoneAccess,
	};
}
