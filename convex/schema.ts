import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const segmentStatusValidator = v.union(
	v.literal("translated"),
	v.literal("failed"),
);

export const acceptedCommitStatusValidator = v.union(
	v.literal("pending"),
	v.literal("translated"),
	v.literal("failed"),
);

export const acceptedCommitTargetStatusValidator = v.union(
	v.literal("pending"),
	v.literal("translated"),
	v.literal("failed"),
);

export const broadcastStatusValidator = v.union(
	v.literal("active"),
	v.literal("lost"),
	v.literal("stopping"),
	v.literal("sealed"),
);

export const translationMappingValidator = v.object({
	term: v.string(),
	targetLanguage: v.string(),
	translation: v.string(),
});

export const translationMappingRevisionTableValidator = v.object({
	sessionId: v.id("sessions"),
	revision: v.number(),
	mappings: v.array(translationMappingValidator),
});

export const translationMappingRevisionDocValidator =
	translationMappingRevisionTableValidator.extend({
		_id: v.id("translationMappingRevisions"),
		_creationTime: v.number(),
	});

export const sessionTableValidator = v.object({
	title: v.string(),
	slug: v.string(),
	ownerId: v.id("users"),
	description: v.optional(v.string()),
	eventDate: v.optional(v.number()),
	spokenLanguages: v.array(v.string()),
	audienceLanguages: v.array(v.string()),
	lastCommitSequence: v.number(),
	lastBroadcastSequence: v.number(),
	deletionRequestedAt: v.optional(v.number()),
	translationMappingRevisionId: v.optional(v.id("translationMappingRevisions")),
	lastActivityAt: v.optional(v.number()),
});

export const sessionDocValidator = sessionTableValidator.extend({
	_id: v.id("sessions"),
	_creationTime: v.number(),
});

export const acceptedCommitTableValidator = v.object({
	sessionId: v.id("sessions"),
	broadcastId: v.id("broadcasts"),
	broadcastSequence: v.number(),
	commitOrdinal: v.number(),
	commitId: v.string(),
	sequence: v.number(),
	sourceText: v.string(),
	sourceLanguage: v.string(),
	translationTargets: v.array(v.string()),
	translationMappingRevisionId: v.optional(v.id("translationMappingRevisions")),
	targetCount: v.number(),
	completedTargetCount: v.number(),
	failedTargetCount: v.number(),
	status: acceptedCommitStatusValidator,
	segmentId: v.optional(v.id("segments")),
	error: v.optional(v.string()),
});

export const acceptedCommitDocValidator = acceptedCommitTableValidator.extend({
	_id: v.id("acceptedCommits"),
	_creationTime: v.number(),
});

export const acceptedCommitTargetTableValidator = v.object({
	acceptedCommitId: v.id("acceptedCommits"),
	sessionId: v.id("sessions"),
	targetLanguage: v.string(),
	status: acceptedCommitTargetStatusValidator,
	translation: v.optional(v.string()),
	error: v.optional(v.string()),
	workId: v.optional(v.string()),
	// Unwritten; kept so rows created before retry pools still validate.
	priority: v.optional(v.union(v.literal("live"), v.literal("retry"))),
	providerAttemptCount: v.optional(v.number()),
});

export const acceptedCommitTargetDocValidator =
	acceptedCommitTargetTableValidator.extend({
		_id: v.id("acceptedCommitTargets"),
		_creationTime: v.number(),
	});

export default defineSchema({
	...authTables,
	sessions: defineTable(sessionTableValidator.fields)
		.index("by_slug", ["slug"])
		.index("by_owner", ["ownerId"]),
	sessionSlugs: defineTable({
		slug: v.string(),
		reservedAt: v.number(),
	}).index("by_slug", ["slug"]),
	translationMappingRevisions: defineTable(
		translationMappingRevisionTableValidator.fields,
	).index("by_session_id_and_revision", ["sessionId", "revision"]),
	acceptedCommits: defineTable(acceptedCommitTableValidator.fields)
		.index("by_session_id_and_commit_id", ["sessionId", "commitId"])
		.index("by_commit_id", ["commitId"])
		.index("by_session_id_and_sequence", ["sessionId", "sequence"])
		.index("by_session_id_and_status", ["sessionId", "status"])
		.index("by_broadcast_id_and_commit_ordinal", [
			"broadcastId",
			"commitOrdinal",
		]),
	acceptedCommitTargets: defineTable(acceptedCommitTargetTableValidator.fields)
		.index("by_session_id", ["sessionId"])
		.index("by_accepted_commit_id_and_target_language", [
			"acceptedCommitId",
			"targetLanguage",
		])
		.index("by_accepted_commit_id_and_status", ["acceptedCommitId", "status"])
		.index("by_work_id", ["workId"]),
	broadcasts: defineTable({
		sessionId: v.id("sessions"),
		sequence: v.number(),
		status: broadcastStatusValidator,
		startedAt: v.number(),
		lastHeartbeatAt: v.number(),
		lastCommitOrdinal: v.number(),
		pendingCommitCount: v.number(),
		finalCommitOrdinal: v.optional(v.number()),
		sealedAt: v.optional(v.number()),
	})
		.index("by_session_id_and_sequence", ["sessionId", "sequence"])
		.index("by_session_id_and_status", ["sessionId", "status"]),
	segments: defineTable({
		sessionId: v.id("sessions"),
		broadcastId: v.id("broadcasts"),
		broadcastSequence: v.number(),
		commitOrdinal: v.number(),
		commitId: v.string(),
		sequence: v.number(),
		sourceText: v.string(),
		sourceLanguage: v.string(),
		status: segmentStatusValidator,
		translations: v.record(v.string(), v.string()),
		acceptedCommitId: v.id("acceptedCommits"),
		error: v.optional(v.string()),
	}).index("by_session_id_and_sequence", ["sessionId", "sequence"]),
});
