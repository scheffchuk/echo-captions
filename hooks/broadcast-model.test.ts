import { ConvexError } from "convex/values";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	acceptCaptionCommit,
	BroadcastCommandConflict,
	BroadcastCommandError,
	createBroadcastCommandGate,
	ignorePresentedBroadcastError,
	RealtimeTranscriptionError,
	toBroadcastCommandError,
} from "@/hooks/broadcast-model";

describe("broadcast command gate", () => {
	it("rejects duplicate commands and releases after the first command settles", async () => {
		const gate = createBroadcastCommandGate();
		let releaseFirst!: () => void;
		const first = gate.run(
			() =>
				new Promise<void>((resolve) => {
					releaseFirst = resolve;
				}),
		);

		expect(gate.isBusy()).toBe(true);
		await expect(gate.run(async () => {})).rejects.toBeInstanceOf(
			BroadcastCommandConflict,
		);

		releaseFirst();
		await first;
		expect(gate.isBusy()).toBe(false);
		await expect(gate.run(async () => "ok")).resolves.toBe("ok");
	});
});

describe("broadcast command error ownership", () => {
	it("submits a caption commit once and leaves reconnect retries to Convex", async () => {
		const failure = new ConvexError({
			code: "broadcast_conflict",
			message: "Try again",
		});
		const accept = vi.fn<() => Promise<void>>().mockRejectedValue(failure);

		await expect(
			Effect.runPromise(acceptCaptionCommit(accept)),
		).rejects.toMatchObject({ message: "Try again" });
		expect(accept).toHaveBeenCalledOnce();

		const defect = new Error("connection closed");
		const interrupted = vi.fn<() => Promise<void>>().mockRejectedValue(defect);
		await expect(
			Effect.runPromise(acceptCaptionCommit(interrupted)),
		).rejects.toBe(defect);
		expect(interrupted).toHaveBeenCalledOnce();
	});

	it("preserves known command failures", () => {
		const error = new BroadcastCommandConflict({ message: "Already busy" });
		expect(toBroadcastCommandError(error)).toBe(error);
		const realtimeError = new RealtimeTranscriptionError({
			message: "Realtime transcription failed",
		});
		expect(toBroadcastCommandError(realtimeError)).toBe(realtimeError);
	});

	it("presents only the safe message carried by a Convex failure", () => {
		const result = toBroadcastCommandError(
			new ConvexError({ code: "broadcast_conflict", message: "Try again" }),
		);
		expect(result).toBeInstanceOf(BroadcastCommandError);
		expect(result.message).toBe("Try again");
	});

	it("uses a stable fallback for malformed Convex failure data", () => {
		const result = toBroadcastCommandError(
			new ConvexError({ code: "unknown" }),
		);
		expect(result.message).toBe("Broadcast command failed");
	});

	it("throws unexpected defects instead of converting them", () => {
		const defect = new Error("secret implementation detail");
		expect(() => toBroadcastCommandError(defect)).toThrow(defect);
		expect(() => ignorePresentedBroadcastError(defect)).toThrow(defect);
	});
});
