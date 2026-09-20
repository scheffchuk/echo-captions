import { Effect, Option, Queue, Schema, Stream } from "effect";

export type AudioDevice = Readonly<{
	deviceId: string;
	label: string;
	groupId: string;
}>;

export type MediaDevicesSource = Readonly<{
	enumerateDevices: () => Promise<readonly MediaDeviceInfo[]>;
	getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
	addEventListener: (type: "devicechange", listener: () => void) => void;
	removeEventListener: (type: "devicechange", listener: () => void) => void;
}>;

export class MicrophonePermissionDenied extends Schema.TaggedError<MicrophonePermissionDenied>()(
	"MicrophonePermissionDenied",
	{
		message: Schema.String,
	},
) {}

export class MicrophoneUnsupported extends Schema.TaggedError<MicrophoneUnsupported>()(
	"MicrophoneUnsupported",
	{
		message: Schema.String,
	},
) {}

export class MicrophoneUnavailable extends Schema.TaggedError<MicrophoneUnavailable>()(
	"MicrophoneUnavailable",
	{
		message: Schema.String,
	},
) {}

export class MicrophoneInterrupted extends Schema.TaggedError<MicrophoneInterrupted>()(
	"MicrophoneInterrupted",
	{
		message: Schema.String,
	},
) {}

export type MicrophoneError =
	| MicrophonePermissionDenied
	| MicrophoneUnsupported
	| MicrophoneUnavailable
	| MicrophoneInterrupted;

export type MicrophoneDeviceSnapshot =
	| Readonly<{
			status: "ready";
			devices: readonly AudioDevice[];
	  }>
	| Readonly<{
			status: "error";
			error: MicrophoneError;
	  }>;

const permissionDeniedMessage =
	"Microphone permission was denied. Turn on microphone access in your browser's site settings and try again.";
const unsupportedMessage =
	"This browser cannot access microphones. Use a secure, supported browser.";
const unavailableMessage =
	"The microphone is unavailable. Connect a microphone or close other apps using it, then try again.";
const interruptedMessage = "Microphone access was interrupted. Try again.";

function browserErrorName(error: unknown): string | undefined {
	if (typeof DOMException === "function") {
		const browserException = Schema.decodeUnknownOption(
			Schema.instanceOf(DOMException),
		)(error);
		const exception = Option.getOrUndefined(browserException);
		if (exception) return exception.name;
	}

	const browserError = Schema.decodeUnknownOption(
		Schema.Struct({ name: Schema.String }),
	)(error);
	return Option.getOrUndefined(Option.map(browserError, ({ name }) => name));
}

export function classifyMicrophoneError(error: unknown): MicrophoneError {
	switch (browserErrorName(error)) {
		case "NotAllowedError":
		case "SecurityError":
			return new MicrophonePermissionDenied({
				message: permissionDeniedMessage,
			});
		case "NotFoundError":
		case "NotReadableError":
		case "OverconstrainedError":
			return new MicrophoneUnavailable({ message: unavailableMessage });
		case "AbortError":
		case "InvalidStateError":
			return new MicrophoneInterrupted({ message: interruptedMessage });
		case "NotSupportedError":
		case "TypeError":
			return new MicrophoneUnsupported({ message: unsupportedMessage });
		default:
			throw error;
	}
}

function cleanDeviceLabel(device: MediaDeviceInfo) {
	const label = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
	return label.replace(/\s*\([^)]*\)/g, "").trim();
}

export function toAudioDevices(
	devices: readonly MediaDeviceInfo[],
): readonly AudioDevice[] {
	return devices.flatMap((device) => {
		if (device.kind !== "audioinput" || device.deviceId.length === 0) {
			return [];
		}
		return [
			{
				deviceId: device.deviceId,
				label: cleanDeviceLabel(device),
				groupId: device.groupId,
			},
		];
	});
}

export const enumerateAudioDevices = Effect.fn(
	"microphone.enumerateAudioDevices",
)((source: MediaDevicesSource) =>
	Effect.tryPromise({
		try: () => source.enumerateDevices(),
		catch: classifyMicrophoneError,
	}).pipe(Effect.map(toAudioDevices)),
);

function stopMediaStream(stream: Pick<MediaStream, "getTracks">) {
	let stoppedWithError = false;
	let firstError: unknown;
	for (const track of stream.getTracks()) {
		try {
			track.stop();
		} catch (error) {
			if (!stoppedWithError) {
				stoppedWithError = true;
				firstError = error;
			}
		}
	}
	if (stoppedWithError) throw firstError;
}

const acquirePermissionStream = Effect.fn("microphone.acquirePermissionStream")(
	(source: MediaDevicesSource) => {
		const acquire = Effect.tryPromise({
			try: (signal) => {
				let interrupted = signal.aborted;
				const onAbort = () => {
					interrupted = true;
				};
				signal.addEventListener("abort", onAbort, { once: true });

				return source.getUserMedia({ audio: true }).then(
					(stream) => {
						signal.removeEventListener("abort", onAbort);
						if (interrupted || signal.aborted) stopMediaStream(stream);
						return stream;
					},
					(error) => {
						signal.removeEventListener("abort", onAbort);
						return Promise.reject(error);
					},
				);
			},
			catch: classifyMicrophoneError,
		});

		return Effect.acquireRelease(acquire, (stream) =>
			Effect.sync(() => stopMediaStream(stream)),
		);
	},
);

export const requestMicrophonePermission = Effect.fn(
	"microphone.requestMicrophonePermission",
)((source: MediaDevicesSource) =>
	Effect.scoped(
		Effect.gen(function* () {
			yield* acquirePermissionStream(source);
			return yield* enumerateAudioDevices(source);
		}),
	),
);

export function createMicrophoneDeviceStream(
	source: MediaDevicesSource,
): Stream.Stream<MicrophoneDeviceSnapshot> {
	return Stream.callback<void>((queue) => {
		const listener = () => Queue.offerUnsafe(queue, undefined);
		return Effect.acquireRelease(
			Effect.sync(() => {
				source.addEventListener("devicechange", listener);
				return listener;
			}),
			(registeredListener) =>
				Effect.sync(() =>
					source.removeEventListener("devicechange", registeredListener),
				),
		).pipe(
			Effect.tap(() => Effect.sync(() => Queue.offerUnsafe(queue, undefined))),
		);
	}).pipe(
		Stream.mapEffect(() =>
			enumerateAudioDevices(source).pipe(
				Effect.map(
					(devices): MicrophoneDeviceSnapshot => ({
						status: "ready",
						devices,
					}),
				),
				Effect.catch(
					(error): Effect.Effect<MicrophoneDeviceSnapshot> =>
						Effect.succeed({ status: "error", error }),
				),
			),
		),
	);
}

export function getBrowserMediaDevices(): MediaDevicesSource | undefined {
	if (typeof navigator === "undefined" || !navigator.mediaDevices) {
		return undefined;
	}

	const mediaDevices = navigator.mediaDevices;
	return {
		enumerateDevices: () => mediaDevices.enumerateDevices(),
		getUserMedia: (constraints) => mediaDevices.getUserMedia(constraints),
		addEventListener: (type, listener) =>
			mediaDevices.addEventListener(type, listener),
		removeEventListener: (type, listener) =>
			mediaDevices.removeEventListener(type, listener),
	};
}

export function unsupportedMicrophoneError() {
	return new MicrophoneUnsupported({ message: unsupportedMessage });
}
