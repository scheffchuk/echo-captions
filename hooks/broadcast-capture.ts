export type CaptureEvent = {
	generation: number;
	commitId: string;
	sourceText: string;
	sourceLanguage: string;
	capturedAt: number;
};

export type CapturedCommit = Omit<CaptureEvent, "generation"> & {
	commitOrdinal: number;
};

export type RejectedCapture = CapturedCommit & {
	reason: string;
};

export type RejectedCaptureOwner = {
	read: (sessionId: string) => readonly RejectedCapture[];
	reject: (
		sessionId: string,
		captures: readonly CapturedCommit[],
		reason: string,
	) => boolean;
	remove: (sessionId: string, commitId: string) => void;
	discardAll: (sessionId: string) => void;
	subscribe: (onChange: (sessionId: string) => void) => () => void;
};

export type CaptureBuffer = {
	generation: number;
	broadcastId: string | null;
	nextCommitOrdinal: number;
	pending: readonly CapturedCommit[];
};

export function createCaptureBuffer({
	generation = 0,
	lastCommitOrdinal = 0,
}: {
	generation?: number;
	lastCommitOrdinal?: number;
} = {}): CaptureBuffer {
	return {
		generation,
		broadcastId: null,
		nextCommitOrdinal: lastCommitOrdinal + 1,
		pending: [],
	};
}

export function isCurrentCaptureGeneration(
	event: Pick<CaptureEvent, "generation">,
	buffer: Pick<CaptureBuffer, "generation">,
) {
	return event.generation === buffer.generation;
}

export function appendCapture(buffer: CaptureBuffer, event: CaptureEvent) {
	if (!isCurrentCaptureGeneration(event, buffer)) {
		return { buffer, capture: null };
	}

	const capture: CapturedCommit = {
		commitId: event.commitId,
		commitOrdinal: buffer.nextCommitOrdinal,
		sourceText: event.sourceText,
		sourceLanguage: event.sourceLanguage,
		capturedAt: event.capturedAt,
	};

	return {
		buffer: {
			...buffer,
			nextCommitOrdinal: buffer.nextCommitOrdinal + 1,
			pending: [...buffer.pending, capture],
		},
		capture,
	};
}

export function activateCaptureBuffer(
	buffer: CaptureBuffer,
	broadcastId: string,
	lastCommitOrdinal: number,
): CaptureBuffer {
	const pending = buffer.pending.map((capture, index) => ({
		...capture,
		commitOrdinal: lastCommitOrdinal + index + 1,
	}));

	return {
		...buffer,
		broadcastId,
		nextCommitOrdinal: lastCommitOrdinal + pending.length + 1,
		pending,
	};
}

export function rebaseCaptures(
	buffer: CaptureBuffer,
	lastCommitOrdinal: number,
): CaptureBuffer {
	const pending = buffer.pending.map((capture, index) => ({
		...capture,
		commitOrdinal: lastCommitOrdinal + index + 1,
	}));

	return {
		...buffer,
		nextCommitOrdinal: lastCommitOrdinal + pending.length + 1,
		pending,
	};
}

export function removeCapture(
	buffer: CaptureBuffer,
	commitId: string,
): CaptureBuffer {
	return {
		...buffer,
		pending: buffer.pending.filter((capture) => capture.commitId !== commitId),
	};
}

export function toRejectedCapture(
	capture: CapturedCommit,
	reason: string,
): RejectedCapture {
	return { ...capture, reason };
}

/**
 * Owns Session-scoped Rejected captures for one in-memory application lifetime.
 * The React provider creates one owner per browser tab application tree; no
 * state is written to durable browser storage.
 */
export function createRejectedCaptureOwner(): RejectedCaptureOwner {
	const rejectedBySession = new Map<string, readonly RejectedCapture[]>();
	const discardedIdsBySession = new Map<string, Set<string>>();
	const listeners = new Set<(sessionId: string) => void>();

	const notify = (sessionId: string) => {
		for (const listener of listeners) listener(sessionId);
	};

	return {
		read: (sessionId) => rejectedBySession.get(sessionId) ?? [],
		reject: (sessionId, captures, reason) => {
			const previous = rejectedBySession.get(sessionId) ?? [];
			const existingIds = new Set(previous.map((capture) => capture.commitId));
			const discardedIds = discardedIdsBySession.get(sessionId);

			const additions = captures.filter(
				(capture) =>
					!existingIds.has(capture.commitId) &&
					!discardedIds?.has(capture.commitId),
			);

			if (additions.length === 0) return false;
			rejectedBySession.set(sessionId, [
				...previous,
				...additions.map((capture) => toRejectedCapture(capture, reason)),
			]);
			notify(sessionId);

			return true;
		},
		remove: (sessionId, commitId) => {
			const previous = rejectedBySession.get(sessionId);

			if (!previous) return;

			const remaining = previous.filter(
				(capture) => capture.commitId !== commitId,
			);

			if (remaining.length === previous.length) return;

			if (remaining.length === 0) rejectedBySession.delete(sessionId);
			else rejectedBySession.set(sessionId, remaining);
			notify(sessionId);
		},
		discardAll: (sessionId) => {
			const previous = rejectedBySession.get(sessionId);

			if (!previous) return;

			const discardedIds =
				discardedIdsBySession.get(sessionId) ?? new Set<string>();

			for (const capture of previous) discardedIds.add(capture.commitId);
			discardedIdsBySession.set(sessionId, discardedIds);
			rejectedBySession.delete(sessionId);
			notify(sessionId);
		},
		subscribe: (onChange) => {
			listeners.add(onChange);

			return () => listeners.delete(onChange);
		},
	};
}

export function formatRejectedCaptures(
	captures: readonly RejectedCapture[],
): string {
	return captures
		.map((capture) =>
			[
				`Commit ID: ${capture.commitId}`,
				`Commit ordinal: ${capture.commitOrdinal}`,
				`Captured at: ${new Date(capture.capturedAt).toISOString()}`,
				`Source language: ${capture.sourceLanguage}`,
				`Reason: ${capture.reason}`,
				"Transcript:",
				capture.sourceText,
			].join("\n"),
		)
		.join("\n\n");
}
