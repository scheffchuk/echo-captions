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

export function appendCapture(
	buffer: CaptureBuffer,
	event: CaptureEvent,
): { buffer: CaptureBuffer; capture: CapturedCommit | null } {
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
