export const CAPTION_TARGET_RETRY_BEHAVIOR = {
	maxAttempts: 3,
	initialBackoffMs: 250,
	base: 2,
} as const;

const MAX_PROVIDER_RETRY_DELAY_MS = 5 * 60 * 1_000;
const MAX_JITTER = 0.2;

export function captionTargetRetryDelay({
	retryAfterMillis,
	previousAttempts,
	jitter,
}: {
	retryAfterMillis?: number;
	previousAttempts: number;
	jitter: number;
}) {
	const backoff =
		CAPTION_TARGET_RETRY_BEHAVIOR.initialBackoffMs *
		CAPTION_TARGET_RETRY_BEHAVIOR.base ** Math.max(0, previousAttempts);
	const providerDelay =
		retryAfterMillis !== undefined &&
		Number.isFinite(retryAfterMillis) &&
		retryAfterMillis > 0
			? retryAfterMillis
			: 0;
	const boundedJitter = Math.min(1, Math.max(0, jitter));
	const jitteredDelay =
		Math.max(backoff, providerDelay) * (1 + boundedJitter * MAX_JITTER);
	return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(jitteredDelay));
}
