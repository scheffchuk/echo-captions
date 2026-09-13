import { Option, Schema } from "effect";

const MIC_DEVICE_PREFIX = "echo-broadcast-mic:";

export function getStoredMicDevice(slug: string): string | null {
	if (typeof window === "undefined") return null;
	const key = `${MIC_DEVICE_PREFIX}${slug}`;
	const stored = localStorage.getItem(key);
	if (stored === null) return null;
	const decoded = Option.getOrUndefined(
		Schema.decodeUnknownOption(Schema.NonEmptyString)(stored),
	);
	if (decoded !== undefined) return decoded;
	localStorage.removeItem(key);
	return null;
}

export function setStoredMicDevice(slug: string, deviceId: string) {
	if (typeof window === "undefined") return;
	if (deviceId.length === 0) {
		localStorage.removeItem(`${MIC_DEVICE_PREFIX}${slug}`);
		return;
	}
	localStorage.setItem(`${MIC_DEVICE_PREFIX}${slug}`, deviceId);
}
