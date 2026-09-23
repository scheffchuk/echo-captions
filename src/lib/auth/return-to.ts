const DEFAULT_RETURN_TO = "/";

export function getBrowserOrigin() {
	return typeof window === "undefined" ? undefined : window.location.origin;
}

export function normalizeReturnTo(
	value: string | undefined,
	origin?: string,
): string {
	if (!value || isProtocolRelative(value)) {
		return DEFAULT_RETURN_TO;
	}

	const isInternalPath = value.startsWith("/");
	const isAbsoluteUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(value);

	if (!isInternalPath && !isAbsoluteUrl) {
		return DEFAULT_RETURN_TO;
	}

	const baseOrigin = origin ?? "https://return-to.invalid";
	let base: URL;
	let destination: URL;

	try {
		base = new URL(baseOrigin);
		destination = new URL(value, base);
	} catch {
		return DEFAULT_RETURN_TO;
	}

	if (destination.origin !== base.origin) {
		return DEFAULT_RETURN_TO;
	}

	return `${destination.pathname}${destination.search}${destination.hash}`;
}

function isProtocolRelative(value: string) {
	return /^[\\/]{2}/.test(value);
}
