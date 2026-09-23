const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string | undefined {
	const normalized = value.trim().toLowerCase();

	return normalized || undefined;
}

export function parseEmail(value: string): string {
	const email = normalizeEmail(value);

	if (!email || !EMAIL_PATTERN.test(email)) {
		throw new Error("Invalid email");
	}

	return email;
}
