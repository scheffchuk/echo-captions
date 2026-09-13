const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return normalized || undefined;
}

export function parseEmail(value: unknown): string {
	const email = normalizeEmail(value);
	if (!email || !EMAIL_PATTERN.test(email)) {
		throw new Error("Invalid email");
	}
	return email;
}
