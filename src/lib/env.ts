export function getConvexUrl() {
	const rawUrl =
		import.meta.env.VITE_CONVEX_URL ?? import.meta.env.NEXT_PUBLIC_CONVEX_URL;

	if (!rawUrl) {
		throw new Error("Missing VITE_CONVEX_URL");
	}

	try {
		const url = new URL(rawUrl);

		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("Unsupported protocol");
		}

		return url.toString().replace(/\/$/, "");
	} catch {
		throw new Error("VITE_CONVEX_URL must be a valid HTTP(S) URL");
	}
}
