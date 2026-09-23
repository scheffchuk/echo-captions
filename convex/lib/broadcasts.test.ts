import { describe, expect, test } from "vitest";
import { testId } from "../../test/ids";
import {
	BROADCAST_HEARTBEAT_TIMEOUT_MS,
	type BroadcastLifecycleState,
	type BroadcastTransition,
	type BroadcastTransitionDecision,
	classifyBroadcastTransition,
	projectBroadcast,
} from "./broadcasts";

const activeBroadcast = {
	status: "active" as const,
	lastCommitOrdinal: 3,
	pendingCommitCount: 1,
	finalCommitOrdinal: undefined,
};

describe("broadcast lifecycle policy", () => {
	const cases: Array<
		[
			string,
			BroadcastLifecycleState,
			BroadcastTransition,
			BroadcastTransitionDecision,
		]
	> = [
		[
			"stops an active broadcast while commits are pending",
			activeBroadcast,
			{ kind: "stop", finalCommitOrdinal: 3 },
			{ kind: "transition", status: "stopping", finalCommitOrdinal: 3 },
		],
		[
			"seals an active broadcast when it is drained",
			{ ...activeBroadcast, pendingCommitCount: 0 },
			{ kind: "stop", finalCommitOrdinal: 3 },
			{ kind: "transition", status: "sealed", finalCommitOrdinal: 3 },
		],
		[
			"abandons a lost broadcast while commits are pending",
			{ ...activeBroadcast, status: "lost" as const },
			{ kind: "abandon", finalCommitOrdinal: 3 },
			{ kind: "transition", status: "stopping", finalCommitOrdinal: 3 },
		],
	];

	test.each(cases)("%s", (_name, state, transition, expected) => {
		expect(classifyBroadcastTransition(state, transition)).toEqual(expected);
	});

	test("resumes a lost broadcast and repeats an active resume idempotently", () => {
		expect(
			classifyBroadcastTransition(
				{ ...activeBroadcast, status: "lost" as const },
				{ kind: "resume" },
			),
		).toEqual({ kind: "resume" });
		expect(
			classifyBroadcastTransition(activeBroadcast, { kind: "resume" }),
		).toEqual({ kind: "noop" });
	});

	test("rejects abandoning a Broadcast that is already stopping", () => {
		expect(
			classifyBroadcastTransition(
				{
					...activeBroadcast,
					status: "stopping" as const,
					finalCommitOrdinal: 3,
				},
				{ kind: "abandon", finalCommitOrdinal: 3 },
			),
		).toEqual({ kind: "invalid", reason: "not_lost" });
	});

	test("reschedules a stale expiry callback while the heartbeat is still valid", () => {
		expect(
			classifyBroadcastTransition(
				{ ...activeBroadcast, lastHeartbeatAt: 1_000 },
				{ kind: "heartbeatExpired", now: 1_001 },
			),
		).toEqual({
			kind: "reschedule",
			delayMs: BROADCAST_HEARTBEAT_TIMEOUT_MS - 1,
		});
	});

	test("marks an expired active broadcast lost", () => {
		expect(
			classifyBroadcastTransition(
				{ ...activeBroadcast, lastHeartbeatAt: 1_000 },
				{
					kind: "heartbeatExpired",
					now: 1_000 + BROADCAST_HEARTBEAT_TIMEOUT_MS,
				},
			),
		).toEqual({ kind: "markLost" });
	});

	test("defects on inconsistent persisted finalization state", () => {
		expect(
			classifyBroadcastTransition(
				{ ...activeBroadcast, status: "stopping" as const },
				{ kind: "stop", finalCommitOrdinal: 3 },
			),
		).toEqual({ kind: "invalid", reason: "invalid_state" });
		expect(
			classifyBroadcastTransition(
				{ ...activeBroadcast, pendingCommitCount: -1 },
				{ kind: "stop", finalCommitOrdinal: 3 },
			),
		).toEqual({ kind: "invalid", reason: "invalid_state" });
	});
});

describe("broadcast projections", () => {
	test("exposes unresolved state to owners but only active state publicly", () => {
		const lost = {
			_id: testId("broadcasts", "broadcast-id"),
			sequence: 2,
			status: "lost" as const,
			lastCommitOrdinal: 3,
			finalCommitOrdinal: undefined,
		};

		expect(projectBroadcast(lost, "owner")).toEqual({
			isLive: false,
			activeBroadcast: lost,
		});
		expect(projectBroadcast(lost, "public")).toEqual({
			isLive: false,
			activeBroadcast: null,
		});
	});
});
