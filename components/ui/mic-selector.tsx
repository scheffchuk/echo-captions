"use client";

import { useAtom } from "@effect/atom-react";
import { Effect, Exit, Option, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { Check, ChevronsUpDown, Mic } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	createMicrophoneDeviceStream,
	errorFromAsyncResult,
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
	const deviceStreamAtom = useMemo(
		() =>
			Atom.fn<never, MicrophoneDeviceSnapshot, void>(() =>
				mediaDevices
					? createMicrophoneDeviceStream(mediaDevices)
					: Stream.succeed<MicrophoneDeviceSnapshot>({
							status: "error",
							error: unsupported,
						}),
			),
		[mediaDevices, unsupported],
	);
	const permissionAtom = useMemo(
		() =>
			Atom.fn<MicrophoneError, void, void>(() =>
				mediaDevices
					? requestMicrophonePermission(mediaDevices).pipe(Effect.asVoid)
					: Effect.fail(unsupported),
			),
		[mediaDevices, unsupported],
	);
	const [deviceState, startDeviceStream] = useAtom(deviceStreamAtom);
	const [permissionState, requestPermission] = useAtom(permissionAtom, {
		mode: "promiseExit",
	});

	useEffect(() => {
		startDeviceStream(undefined);
	}, [startDeviceStream]);

	const deviceEffectError = errorFromAsyncResult(deviceState);
	if (deviceEffectError !== undefined) throw deviceEffectError;
	const permissionError = errorFromAsyncResult(permissionState);
	const snapshot = Option.getOrUndefined(AsyncResult.value(deviceState));
	const devices = snapshot?.status === "ready" ? snapshot.devices : [];
	const enumerationError =
		snapshot?.status === "error" ? snapshot.error : undefined;
	const typedError = permissionError ?? enumerationError ?? null;
	const error = typedError?.message ?? null;
	const loading = snapshot === undefined || permissionState.waiting;
	const hasPermission = AsyncResult.isSuccess(permissionState);

	useEffect(() => {
		if (typedError) onError?.(typedError.message);
	}, [onError, typedError]);

	const requestMicrophoneAccess = useCallback(async () => {
		const result = await requestPermission(undefined);
		if (Exit.isSuccess(result)) startDeviceStream(undefined);
		return result;
	}, [requestPermission, startDeviceStream]);

	return {
		devices,
		loading,
		error,
		errorCause: typedError,
		hasPermission,
		deviceState,
		permissionState,
		requestMicrophoneAccess,
	};
}
