import { v } from "convex/values";
import { Effect } from "effect";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { exhaustPublicErrors, fromConvex } from "./effect/convex";
import { runConvex } from "./effect/run";
import { authErrorCodes, getCurrentOperatorId, getOperator } from "./lib/auth";
import {
	getBroadcastProjection,
	getUnresolvedBroadcast,
	type projectBroadcast,
	readBroadcastProjection,
} from "./lib/broadcasts";
import {
	computeAudienceLanguages,
	languageErrorCodes,
	normalizeLanguageList,
	validateAudienceLanguagesExtra,
	validateSpokenLanguages,
} from "./lib/languages";
import {
	getOwnedSession,
	InvalidSessionTransition,
	nowMillis,
	SessionBusy,
	SessionDeleting,
	sessionErrorCodes,
	uniqueSessionSlug,
} from "./lib/sessions";
import {
	canonicalizeTranslationMappings,
	canonicalTranslationMappingsEqual,
	filterMappingsForAudience,
	MappingRevisionConflict,
	MappingValidationError,
	type TranslationMapping,
} from "./lib/translationMappings";

import {
	broadcastStatusValidator,
	sessionDocValidator,
	translationMappingValidator,
} from "./schema";

const SEGMENT_DELETE_BATCH_SIZE = 100;
const ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE = 100;
const ACCEPTED_COMMIT_DELETE_BATCH_SIZE = 100;
const BROADCAST_DELETE_BATCH_SIZE = 100;
const MAPPING_REVISION_DELETE_BATCH_SIZE = 100;
const publicErrorCodes = {
	...authErrorCodes,
	...languageErrorCodes,
	...sessionErrorCodes,
	MappingRevisionConflict: "mapping_revision_conflict",
	MappingValidationError: "mapping_validation_error",
};

const eventFields = {
	description: v.optional(v.string()),
	eventDate: v.optional(v.number()),
	spokenLanguages: v.array(v.string()),
	audienceLanguagesExtra: v.optional(v.array(v.string())),
	translationMappings: v.optional(v.array(translationMappingValidator)),
};

const storedSessionValidator = sessionDocValidator;

const sessionValidator = storedSessionValidator.extend({
	translationMappings: v.array(translationMappingValidator),
});

const activeBroadcastValidator = v.union(
	v.object({
		_id: v.id("broadcasts"),
		sequence: v.number(),
		status: broadcastStatusValidator,
		lastCommitOrdinal: v.number(),
		finalCommitOrdinal: v.optional(v.number()),
	}),
	v.null(),
);

const sessionViewValidator = sessionValidator.extend({
	isLive: v.boolean(),
	activeBroadcast: activeBroadcastValidator,
});

const publicSessionValidator = sessionValidator
	.pick("_id", "title", "slug", "audienceLanguages", "description", "eventDate")
	.extend({
		isLive: v.boolean(),
		activeBroadcast: activeBroadcastValidator,
	});

type EventFields = {
	description?: string;
	eventDate?: number;
	spokenLanguages: string[];
	audienceLanguagesExtra?: string[];
	translationMappings?: TranslationMapping[];
};

const getCurrentMappingRevision = Effect.fn(
	"Sessions.getCurrentMappingRevision",
)(function* (ctx: MutationCtx, session: Doc<"sessions">) {
	if (session.translationMappingRevisionId === undefined) return null;
	const revision = yield* fromConvex(
		() =>
			ctx.db.get(
				"translationMappingRevisions",
				session.translationMappingRevisionId as Id<"translationMappingRevisions">,
			),
		"Sessions.getCurrentMappingRevision",
	);
	if (!revision || revision.sessionId !== session._id) {
		return yield* new MappingValidationError({
			message: "The Session mapping revision is unavailable",
		});
	}
	return revision;
});

const nextMappingRevision = Effect.fn("Sessions.nextMappingRevision")(
	function* (
		ctx: MutationCtx,
		sessionId: Id<"sessions">,
		mappings: TranslationMapping[],
	) {
		const latest = yield* fromConvex(
			() =>
				ctx.db
					.query("translationMappingRevisions")
					.withIndex("by_session_id_and_revision", (q) =>
						q.eq("sessionId", sessionId),
					)
					.order("desc")
					.first(),
			"Sessions.nextMappingRevision.latest",
		);
		return yield* fromConvex(
			() =>
				ctx.db.insert("translationMappingRevisions", {
					sessionId,
					revision: (latest?.revision ?? 0) + 1,
					mappings,
				}),
			"Sessions.nextMappingRevision.insert",
		);
	},
);

const createSession = Effect.fn("Sessions.create")(function* (
	ctx: MutationCtx,
	args: { title: string } & EventFields,
) {
	const ownerId = yield* getOperator(ctx);
	const spokenLanguages = yield* validateSpokenLanguages(args.spokenLanguages);
	const audienceLanguagesExtra = yield* validateAudienceLanguagesExtra(
		spokenLanguages,
		args.audienceLanguagesExtra,
	);
	const audienceLanguages = computeAudienceLanguages(
		spokenLanguages,
		audienceLanguagesExtra,
	);
	const mappings = yield* canonicalizeTranslationMappings(
		args.translationMappings ?? [],
		audienceLanguages,
	);
	const slug = yield* uniqueSessionSlug(ctx);
	const reservedAt = yield* nowMillis();

	const {
		title,
		translationMappings: _mappings,
		spokenLanguages: _spoken,
		audienceLanguagesExtra: _extra,
		...rest
	} = args;

	yield* fromConvex(
		() => ctx.db.insert("sessionSlugs", { slug, reservedAt }),
		"Sessions.create.reserveSlug",
	);
	const sessionId = yield* fromConvex(
		() =>
			ctx.db.insert("sessions", {
				title: title.trim() || "Untitled",
				slug,
				ownerId,
				spokenLanguages,
				audienceLanguages,
				lastCommitSequence: 0,
				lastBroadcastSequence: 0,
				...rest,
			}),
		"Sessions.create.insert",
	);
	if (mappings.length > 0) {
		const revisionId = yield* nextMappingRevision(ctx, sessionId, mappings);
		yield* fromConvex(
			() =>
				ctx.db.patch(sessionId, { translationMappingRevisionId: revisionId }),
			"Sessions.create.setMappingRevision",
		);
	}

	return { slug };
});

const getPublicBySlug = Effect.fn("Sessions.getBySlug")(function* (
	ctx: QueryCtx,
	slug: string,
) {
	const session = yield* fromConvex(
		() =>
			ctx.db
				.query("sessions")
				.withIndex("by_slug", (q) => q.eq("slug", slug))
				.unique(),
		"Sessions.getBySlug",
	);
	if (!session || session.deletionRequestedAt !== undefined) return null;
	const broadcastProjection = yield* getBroadcastProjection(
		ctx,
		session._id,
		"public",
	);
	return {
		_id: session._id,
		title: session.title,
		slug: session.slug,
		audienceLanguages: normalizeLanguageList(session.audienceLanguages),
		description: session.description,
		eventDate: session.eventDate,
		...broadcastProjection,
	};
});

const addLiveState = Effect.fn("Sessions.addLiveState")(function* (
	ctx: QueryCtx,
	session: Doc<"sessions">,
) {
	const translationMappings = yield* fromConvex(
		() => readSessionTranslationMappings(ctx, session),
		"Sessions.addLiveState.mappingRevision",
	);
	const broadcastProjection = yield* getBroadcastProjection(
		ctx,
		session._id,
		"owner",
	);
	return toSessionView(session, translationMappings, broadcastProjection);
});

async function readSessionTranslationMappings(
	ctx: QueryCtx,
	session: Doc<"sessions">,
) {
	if (!session.translationMappingRevisionId) return [];
	const mappingRevision = await ctx.db.get(
		"translationMappingRevisions",
		session.translationMappingRevisionId as Id<"translationMappingRevisions">,
	);
	if (!mappingRevision || mappingRevision.sessionId !== session._id) {
		throw new Error("Session mapping revision is unavailable");
	}
	return mappingRevision.mappings;
}

function toSessionView(
	session: Doc<"sessions">,
	translationMappings: Doc<"translationMappingRevisions">["mappings"],
	broadcastProjection: ReturnType<typeof projectBroadcast>,
) {
	return {
		...session,
		translationMappings,
		...broadcastProjection,
	};
}

async function getOwnedSessionView(ctx: QueryCtx, session: Doc<"sessions">) {
	const translationMappings = await readSessionTranslationMappings(
		ctx,
		session,
	);
	const broadcastProjection = await readBroadcastProjection(
		ctx,
		session._id,
		"owner",
	);
	return toSessionView(session, translationMappings, broadcastProjection);
}

const patchDescription = Effect.fn("Sessions.updateDescription")(function* (
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
	description: string,
) {
	const ownerId = yield* getOperator(ctx);
	const session = yield* getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	yield* fromConvex(
		() =>
			ctx.db.patch(sessionId, {
				description: description.trim() || undefined,
			}),
		"Sessions.updateDescription",
	);
	return null;
});

const patchTranslationMappings = Effect.fn(
	"Sessions.updateTranslationMappings",
)(function* (
	ctx: MutationCtx,
	args: {
		sessionId: Id<"sessions">;
		translationMappings: TranslationMapping[];
		expectedRevisionId: Id<"translationMappingRevisions"> | null;
	},
) {
	const ownerId = yield* getOperator(ctx);
	const session = yield* getOwnedSession(ctx, args.sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	const audienceLanguages = normalizeLanguageList(session.audienceLanguages);
	const mappings = yield* canonicalizeTranslationMappings(
		args.translationMappings,
		audienceLanguages,
	);
	const currentRevision = yield* getCurrentMappingRevision(ctx, session);
	const currentRevisionId = session.translationMappingRevisionId ?? null;
	if (args.expectedRevisionId !== currentRevisionId) {
		return yield* new MappingRevisionConflict({
			message: "Glossary changed elsewhere. Reload it before saving.",
		});
	}
	if (
		currentRevision &&
		canonicalTranslationMappingsEqual(currentRevision.mappings, mappings)
	) {
		return { revisionId: currentRevision._id, changed: false };
	}
	if (!currentRevision && mappings.length === 0) {
		return { revisionId: null, changed: false };
	}
	if (mappings.length === 0) {
		yield* fromConvex(
			() =>
				ctx.db.patch(args.sessionId, {
					translationMappingRevisionId: undefined,
				}),
			"Sessions.updateTranslationMappings.clear",
		);
		return { revisionId: null, changed: true };
	}

	const revisionId = yield* nextMappingRevision(ctx, args.sessionId, mappings);
	yield* fromConvex(
		() =>
			ctx.db.patch(args.sessionId, {
				translationMappingRevisionId: revisionId,
			}),
		"Sessions.updateTranslationMappings.setRevision",
	);
	return { revisionId, changed: true };
});

const patchLanguages = Effect.fn("Sessions.updateLanguages")(function* (
	ctx: MutationCtx,
	args: {
		sessionId: Id<"sessions">;
		spokenLanguages: string[];
		audienceLanguagesExtra?: string[];
	},
) {
	const ownerId = yield* getOperator(ctx);
	const session = yield* getOwnedSession(ctx, args.sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	const spokenLanguages = yield* validateSpokenLanguages(args.spokenLanguages);
	const audienceLanguagesExtra = yield* validateAudienceLanguagesExtra(
		spokenLanguages,
		args.audienceLanguagesExtra,
	);
	const audienceLanguages = computeAudienceLanguages(
		spokenLanguages,
		audienceLanguagesExtra,
	);
	const currentRevision = yield* getCurrentMappingRevision(ctx, session);
	const mappings = yield* canonicalizeTranslationMappings(
		filterMappingsForAudience(
			currentRevision?.mappings ?? [],
			audienceLanguages,
		),
		audienceLanguages,
	);
	let translationMappingRevisionId = session.translationMappingRevisionId;
	if (
		!currentRevision ||
		!canonicalTranslationMappingsEqual(currentRevision.mappings, mappings)
	) {
		translationMappingRevisionId =
			mappings.length > 0
				? yield* nextMappingRevision(ctx, args.sessionId, mappings)
				: undefined;
	}

	yield* fromConvex(
		() =>
			ctx.db.patch(args.sessionId, {
				spokenLanguages,
				audienceLanguages,
				translationMappingRevisionId,
			}),
		"Sessions.updateLanguages",
	);
	return null;
});

const patchTitle = Effect.fn("Sessions.updateTitle")(function* (
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
	title: string,
) {
	const ownerId = yield* getOperator(ctx);
	const session = yield* getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		return yield* new SessionDeleting({ message: "Session is being deleted" });
	}
	yield* fromConvex(
		() =>
			ctx.db.patch(sessionId, {
				title: title.trim() || "Untitled",
			}),
		"Sessions.updateTitle",
	);
	return null;
});

const removeSession = Effect.fn("Sessions.delete")(function* (
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
) {
	const ownerId = yield* getOperator(ctx);
	const session = yield* getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) return null;

	const unresolvedBroadcast = yield* getUnresolvedBroadcast(ctx, sessionId);
	if (unresolvedBroadcast) {
		return yield* new InvalidSessionTransition({
			message:
				"Resolve the active or Lost Broadcast before deleting the Session",
		});
	}

	const pendingAcceptedCommit = yield* fromConvex(
		() =>
			ctx.db
				.query("acceptedCommits")
				.withIndex("by_session_id_and_status", (q) =>
					q.eq("sessionId", sessionId).eq("status", "pending"),
				)
				.first(),
		"Sessions.delete.findPendingAcceptedCommit",
	);
	if (pendingAcceptedCommit) {
		return yield* new SessionBusy({
			message: "Wait for active translations to finish before deleting",
		});
	}

	const slugReservation = yield* fromConvex(
		() =>
			ctx.db
				.query("sessionSlugs")
				.withIndex("by_slug", (q) => q.eq("slug", session.slug))
				.unique(),
		"Sessions.delete.findSlugReservation",
	);
	if (!slugReservation) {
		const reservedAt = yield* nowMillis();
		yield* fromConvex(
			() =>
				ctx.db.insert("sessionSlugs", {
					slug: session.slug,
					reservedAt,
				}),
			"Sessions.delete.reserveSlug",
		);
	}

	const deletionRequestedAt = yield* nowMillis();
	yield* fromConvex(
		() => ctx.db.patch(sessionId, { deletionRequestedAt }),
		"Sessions.delete.markRequested",
	);
	yield* fromConvex(
		() =>
			ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, { sessionId }),
		"Sessions.delete.scheduleBatch",
	);
	return null;
});

const deleteSessionBatch: (
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
) => Effect.Effect<null, unknown> = Effect.fn("Sessions.deleteBatch")(
	function* (ctx: MutationCtx, sessionId: Id<"sessions">) {
		const session = yield* fromConvex(
			() => ctx.db.get("sessions", sessionId),
			"Sessions.deleteBatch.getSession",
		);
		if (!session || session.deletionRequestedAt === undefined) return null;

		const segments = yield* fromConvex(
			() =>
				ctx.db
					.query("segments")
					.withIndex("by_session_id_and_sequence", (q) =>
						q.eq("sessionId", sessionId),
					)
					.take(SEGMENT_DELETE_BATCH_SIZE + 1),
			"Sessions.deleteBatch.listSegments",
		);
		const batch = segments.slice(0, SEGMENT_DELETE_BATCH_SIZE);
		yield* Effect.forEach(batch, (segment) =>
			fromConvex(
				() => ctx.db.delete("segments", segment._id),
				"Sessions.deleteBatch.deleteSegment",
			),
		);

		if (segments.length > SEGMENT_DELETE_BATCH_SIZE) {
			yield* fromConvex(
				() =>
					ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
						sessionId,
					}),
				"Sessions.deleteBatch.scheduleNext",
			);
			return null;
		}

		const acceptedCommitTargets = yield* fromConvex(
			() =>
				ctx.db
					.query("acceptedCommitTargets")
					.withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
					.take(ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE + 1),
			"Sessions.deleteBatch.listAcceptedCommitTargets",
		);
		const acceptedCommitTargetBatch = acceptedCommitTargets.slice(
			0,
			ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE,
		);
		yield* Effect.forEach(acceptedCommitTargetBatch, (target) =>
			fromConvex(
				() => ctx.db.delete("acceptedCommitTargets", target._id),
				"Sessions.deleteBatch.deleteAcceptedCommitTarget",
			),
		);
		if (
			acceptedCommitTargets.length > ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE
		) {
			yield* fromConvex(
				() =>
					ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
						sessionId,
					}),
				"Sessions.deleteBatch.scheduleAcceptedCommitTargets",
			);
			return null;
		}

		const acceptedCommits = yield* fromConvex(
			() =>
				ctx.db
					.query("acceptedCommits")
					.withIndex("by_session_id_and_sequence", (q) =>
						q.eq("sessionId", sessionId),
					)
					.take(ACCEPTED_COMMIT_DELETE_BATCH_SIZE + 1),
			"Sessions.deleteBatch.listAcceptedCommits",
		);
		const acceptedCommitBatch = acceptedCommits.slice(
			0,
			ACCEPTED_COMMIT_DELETE_BATCH_SIZE,
		);
		yield* Effect.forEach(acceptedCommitBatch, (commit) =>
			fromConvex(
				() => ctx.db.delete("acceptedCommits", commit._id),
				"Sessions.deleteBatch.deleteAcceptedCommit",
			),
		);
		if (acceptedCommits.length > ACCEPTED_COMMIT_DELETE_BATCH_SIZE) {
			yield* fromConvex(
				() =>
					ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
						sessionId,
					}),
				"Sessions.deleteBatch.scheduleAcceptedCommits",
			);
			return null;
		}

		const broadcasts = yield* fromConvex(
			() =>
				ctx.db
					.query("broadcasts")
					.withIndex("by_session_id_and_sequence", (q) =>
						q.eq("sessionId", sessionId),
					)
					.take(BROADCAST_DELETE_BATCH_SIZE + 1),
			"Sessions.deleteBatch.listBroadcasts",
		);
		const broadcastBatch = broadcasts.slice(0, BROADCAST_DELETE_BATCH_SIZE);
		yield* Effect.forEach(broadcastBatch, (broadcast) =>
			fromConvex(
				() => ctx.db.delete("broadcasts", broadcast._id),
				"Sessions.deleteBatch.deleteBroadcast",
			),
		);
		if (broadcasts.length > BROADCAST_DELETE_BATCH_SIZE) {
			yield* fromConvex(
				() =>
					ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
						sessionId,
					}),
				"Sessions.deleteBatch.scheduleBroadcasts",
			);
			return null;
		}

		const mappingRevisions = yield* fromConvex(
			() =>
				ctx.db
					.query("translationMappingRevisions")
					.withIndex("by_session_id_and_revision", (q) =>
						q.eq("sessionId", sessionId),
					)
					.take(MAPPING_REVISION_DELETE_BATCH_SIZE + 1),
			"Sessions.deleteBatch.listMappingRevisions",
		);
		const mappingRevisionBatch = mappingRevisions.slice(
			0,
			MAPPING_REVISION_DELETE_BATCH_SIZE,
		);
		yield* Effect.forEach(mappingRevisionBatch, (revision) =>
			fromConvex(
				() => ctx.db.delete("translationMappingRevisions", revision._id),
				"Sessions.deleteBatch.deleteMappingRevision",
			),
		);
		if (mappingRevisions.length > MAPPING_REVISION_DELETE_BATCH_SIZE) {
			yield* fromConvex(
				() =>
					ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
						sessionId,
					}),
				"Sessions.deleteBatch.scheduleMappingRevisions",
			);
			return null;
		}

		yield* fromConvex(
			() => ctx.db.delete("sessions", sessionId),
			"Sessions.deleteBatch.deleteSession",
		);
		return null;
	},
);

export const create = mutation({
	args: {
		title: v.string(),
		...eventFields,
	},
	returns: v.object({ slug: v.string() }),
	handler: (ctx, args) =>
		runConvex(
			createSession(ctx, args).pipe(exhaustPublicErrors(publicErrorCodes)),
		),
});

export const listMine = query({
	args: {},
	// null = signed out (logout re-runs this subscription); [] = no events
	returns: v.union(v.array(sessionViewValidator), v.null()),
	handler: async (ctx) => {
		const ownerId = await getCurrentOperatorId(ctx);
		if (!ownerId) {
			return null;
		}
		const sessions = await ctx.db
			.query("sessions")
			.withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
			.order("desc")
			.collect();
		return await Promise.all(
			sessions.map((session) =>
				runConvex(addLiveState(ctx, session).pipe(Effect.orDie)),
			),
		);
	},
});

export const getBySlug = query({
	args: { slug: v.string() },
	returns: v.union(publicSessionValidator, v.null()),
	handler: (ctx, args) =>
		runConvex(getPublicBySlug(ctx, args.slug).pipe(Effect.orDie)),
});

export const getMineBySlug = query({
	args: { slug: v.string() },
	returns: v.union(sessionViewValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerId = await getCurrentOperatorId(ctx);
		if (!ownerId) {
			return null;
		}
		const session = await ctx.db
			.query("sessions")
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.unique();
		if (!session || session.ownerId !== ownerId) return null;
		return await getOwnedSessionView(ctx, session);
	},
});

export const updateDescription = mutation({
	args: {
		sessionId: v.id("sessions"),
		description: v.string(),
	},
	returns: v.null(),
	handler: (ctx, args) =>
		runConvex(
			patchDescription(ctx, args.sessionId, args.description).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const getForAction = internalQuery({
	args: { sessionId: v.id("sessions") },
	returns: v.union(storedSessionValidator, v.null()),
	handler: (ctx, args) =>
		runConvex(
			fromConvex(
				() => ctx.db.get("sessions", args.sessionId),
				"Sessions.getForAction",
			).pipe(Effect.orDie),
		),
});

export const updateTranslationMappings = mutation({
	args: {
		sessionId: v.id("sessions"),
		translationMappings: v.array(translationMappingValidator),
		expectedRevisionId: v.union(v.id("translationMappingRevisions"), v.null()),
	},
	returns: v.object({
		revisionId: v.union(v.id("translationMappingRevisions"), v.null()),
		changed: v.boolean(),
	}),
	handler: (ctx, args) =>
		runConvex(
			patchTranslationMappings(ctx, args).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const updateLanguages = mutation({
	args: {
		sessionId: v.id("sessions"),
		spokenLanguages: v.array(v.string()),
		audienceLanguagesExtra: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: (ctx, args) =>
		runConvex(
			patchLanguages(ctx, args).pipe(exhaustPublicErrors(publicErrorCodes)),
		),
});

export const updateTitle = mutation({
	args: {
		sessionId: v.id("sessions"),
		title: v.string(),
	},
	returns: v.null(),
	handler: (ctx, args) =>
		runConvex(
			patchTitle(ctx, args.sessionId, args.title).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const deleteSession = mutation({
	args: {
		sessionId: v.id("sessions"),
	},
	returns: v.null(),
	handler: (ctx, args): Promise<null> =>
		runConvex(
			removeSession(ctx, args.sessionId).pipe(
				exhaustPublicErrors(publicErrorCodes),
			),
		),
});

export const deleteBatch = internalMutation({
	args: { sessionId: v.id("sessions") },
	returns: v.null(),
	handler: (ctx, args): Promise<null> =>
		runConvex(deleteSessionBatch(ctx, args.sessionId).pipe(Effect.orDie)),
});
