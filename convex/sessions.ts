import { ConvexError, v } from "convex/values";
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
import {
	authErrorCodes,
	getCurrentOperatorId,
	requireCurrentOperatorId,
} from "./lib/auth";
import {
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

type TaggedPublicError = {
	readonly _tag: string;
	readonly message: string;
};

function isTaggedPublicError(error: unknown): error is TaggedPublicError {
	if (typeof error !== "object" || error === null) return false;
	const candidate = error as { _tag?: unknown; message?: unknown };
	return (
		typeof candidate._tag === "string" && typeof candidate.message === "string"
	);
}

async function atPublicEdge<A>(operation: () => Promise<A>): Promise<A> {
	try {
		return await operation();
	} catch (error) {
		if (isTaggedPublicError(error)) {
			const code =
				publicErrorCodes[error._tag as keyof typeof publicErrorCodes];
			if (code !== undefined) {
				throw new ConvexError({ code, message: error.message });
			}
		}
		throw error;
	}
}

async function getCurrentMappingRevision(
	ctx: MutationCtx,
	session: Doc<"sessions">,
) {
	if (session.translationMappingRevisionId === undefined) return null;
	const revision = await ctx.db.get(
		"translationMappingRevisions",
		session.translationMappingRevisionId as Id<"translationMappingRevisions">,
	);
	if (!revision || revision.sessionId !== session._id) {
		throw new MappingValidationError({
			message: "The Session mapping revision is unavailable",
		});
	}
	return revision;
}

async function nextMappingRevision(
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
	mappings: TranslationMapping[],
) {
	const latest = await ctx.db
		.query("translationMappingRevisions")
		.withIndex("by_session_id_and_revision", (q) =>
			q.eq("sessionId", sessionId),
		)
		.order("desc")
		.first();
	return await ctx.db.insert("translationMappingRevisions", {
		sessionId,
		revision: (latest?.revision ?? 0) + 1,
		mappings,
	});
}

async function createSession(
	ctx: MutationCtx,
	args: { title: string } & EventFields,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const spokenLanguages = validateSpokenLanguages(args.spokenLanguages);
	const audienceLanguagesExtra = validateAudienceLanguagesExtra(
		spokenLanguages,
		args.audienceLanguagesExtra,
	);
	const audienceLanguages = computeAudienceLanguages(
		spokenLanguages,
		audienceLanguagesExtra,
	);
	const mappings = canonicalizeTranslationMappings(
		args.translationMappings ?? [],
		audienceLanguages,
	);
	const slug = await uniqueSessionSlug(ctx);
	const reservedAt = Date.now();

	const {
		title,
		translationMappings: _mappings,
		spokenLanguages: _spoken,
		audienceLanguagesExtra: _extra,
		...rest
	} = args;

	await ctx.db.insert("sessionSlugs", { slug, reservedAt });
	const sessionId = await ctx.db.insert("sessions", {
		title: title.trim() || "Untitled",
		slug,
		ownerId,
		spokenLanguages,
		audienceLanguages,
		lastCommitSequence: 0,
		lastBroadcastSequence: 0,
		...rest,
	});
	if (mappings.length > 0) {
		const revisionId = await nextMappingRevision(ctx, sessionId, mappings);
		await ctx.db.patch(sessionId, { translationMappingRevisionId: revisionId });
	}

	return { slug };
}

async function getPublicBySlug(ctx: QueryCtx, slug: string) {
	const session = await ctx.db
		.query("sessions")
		.withIndex("by_slug", (q) => q.eq("slug", slug))
		.unique();
	if (!session || session.deletionRequestedAt !== undefined) return null;
	return {
		_id: session._id,
		title: session.title,
		slug: session.slug,
		audienceLanguages: normalizeLanguageList(session.audienceLanguages),
		description: session.description,
		eventDate: session.eventDate,
		...(await readBroadcastProjection(ctx, session._id, "public")),
	};
}

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

async function getSessionView(ctx: QueryCtx, session: Doc<"sessions">) {
	return toSessionView(
		session,
		await readSessionTranslationMappings(ctx, session),
		await readBroadcastProjection(ctx, session._id, "owner"),
	);
}

async function patchDescription(
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
	description: string,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const session = await getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}
	await ctx.db.patch(sessionId, {
		description: description.trim() || undefined,
	});
	return null;
}

async function patchTranslationMappings(
	ctx: MutationCtx,
	args: {
		sessionId: Id<"sessions">;
		translationMappings: TranslationMapping[];
		expectedRevisionId: Id<"translationMappingRevisions"> | null;
	},
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const session = await getOwnedSession(ctx, args.sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}
	const audienceLanguages = normalizeLanguageList(session.audienceLanguages);
	const mappings = canonicalizeTranslationMappings(
		args.translationMappings,
		audienceLanguages,
	);
	const currentRevision = await getCurrentMappingRevision(ctx, session);
	const currentRevisionId = session.translationMappingRevisionId ?? null;
	if (args.expectedRevisionId !== currentRevisionId) {
		throw new MappingRevisionConflict({
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
		await ctx.db.patch(args.sessionId, {
			translationMappingRevisionId: undefined,
		});
		return { revisionId: null, changed: true };
	}

	const revisionId = await nextMappingRevision(ctx, args.sessionId, mappings);
	await ctx.db.patch(args.sessionId, {
		translationMappingRevisionId: revisionId,
	});
	return { revisionId, changed: true };
}

async function patchLanguages(
	ctx: MutationCtx,
	args: {
		sessionId: Id<"sessions">;
		spokenLanguages: string[];
		audienceLanguagesExtra?: string[];
	},
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const session = await getOwnedSession(ctx, args.sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}
	const spokenLanguages = validateSpokenLanguages(args.spokenLanguages);
	const audienceLanguagesExtra = validateAudienceLanguagesExtra(
		spokenLanguages,
		args.audienceLanguagesExtra,
	);
	const audienceLanguages = computeAudienceLanguages(
		spokenLanguages,
		audienceLanguagesExtra,
	);
	const currentRevision = await getCurrentMappingRevision(ctx, session);
	const mappings = canonicalizeTranslationMappings(
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
				? await nextMappingRevision(ctx, args.sessionId, mappings)
				: undefined;
	}

	await ctx.db.patch(args.sessionId, {
		spokenLanguages,
		audienceLanguages,
		translationMappingRevisionId,
	});
	return null;
}

async function patchTitle(
	ctx: MutationCtx,
	sessionId: Id<"sessions">,
	title: string,
) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const session = await getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) {
		throw new SessionDeleting({ message: "Session is being deleted" });
	}
	await ctx.db.patch(sessionId, {
		title: title.trim() || "Untitled",
	});
	return null;
}

async function removeSession(ctx: MutationCtx, sessionId: Id<"sessions">) {
	const ownerId = await requireCurrentOperatorId(ctx);
	const session = await getOwnedSession(ctx, sessionId, ownerId);
	if (session.deletionRequestedAt !== undefined) return null;

	const broadcastProjection = await readBroadcastProjection(
		ctx,
		sessionId,
		"owner",
	);
	if (broadcastProjection.activeBroadcast) {
		throw new InvalidSessionTransition({
			message:
				"Resolve the active or Lost Broadcast before deleting the Session",
		});
	}

	const pendingAcceptedCommit = await ctx.db
		.query("acceptedCommits")
		.withIndex("by_session_id_and_status", (q) =>
			q.eq("sessionId", sessionId).eq("status", "pending"),
		)
		.first();
	if (pendingAcceptedCommit) {
		throw new SessionBusy({
			message: "Wait for active translations to finish before deleting",
		});
	}

	const slugReservation = await ctx.db
		.query("sessionSlugs")
		.withIndex("by_slug", (q) => q.eq("slug", session.slug))
		.unique();
	if (!slugReservation) {
		await ctx.db.insert("sessionSlugs", {
			slug: session.slug,
			reservedAt: Date.now(),
		});
	}

	await ctx.db.patch(sessionId, { deletionRequestedAt: Date.now() });
	await ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, { sessionId });
	return null;
}

async function deleteSessionBatch(ctx: MutationCtx, sessionId: Id<"sessions">) {
	const session = await ctx.db.get("sessions", sessionId);
	if (!session || session.deletionRequestedAt === undefined) return null;

	const segments = await ctx.db
		.query("segments")
		.withIndex("by_session_id_and_sequence", (q) =>
			q.eq("sessionId", sessionId),
		)
		.take(SEGMENT_DELETE_BATCH_SIZE + 1);
	for (const segment of segments.slice(0, SEGMENT_DELETE_BATCH_SIZE)) {
		await ctx.db.delete("segments", segment._id);
	}

	if (segments.length > SEGMENT_DELETE_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
			sessionId,
		});
		return null;
	}

	const acceptedCommitTargets = await ctx.db
		.query("acceptedCommitTargets")
		.withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
		.take(ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE + 1);
	for (const target of acceptedCommitTargets.slice(
		0,
		ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE,
	)) {
		await ctx.db.delete("acceptedCommitTargets", target._id);
	}
	if (acceptedCommitTargets.length > ACCEPTED_COMMIT_TARGET_DELETE_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
			sessionId,
		});
		return null;
	}

	const acceptedCommits = await ctx.db
		.query("acceptedCommits")
		.withIndex("by_session_id_and_sequence", (q) =>
			q.eq("sessionId", sessionId),
		)
		.take(ACCEPTED_COMMIT_DELETE_BATCH_SIZE + 1);
	for (const commit of acceptedCommits.slice(
		0,
		ACCEPTED_COMMIT_DELETE_BATCH_SIZE,
	)) {
		await ctx.db.delete("acceptedCommits", commit._id);
	}
	if (acceptedCommits.length > ACCEPTED_COMMIT_DELETE_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
			sessionId,
		});
		return null;
	}

	const broadcasts = await ctx.db
		.query("broadcasts")
		.withIndex("by_session_id_and_sequence", (q) =>
			q.eq("sessionId", sessionId),
		)
		.take(BROADCAST_DELETE_BATCH_SIZE + 1);
	for (const broadcast of broadcasts.slice(0, BROADCAST_DELETE_BATCH_SIZE)) {
		await ctx.db.delete("broadcasts", broadcast._id);
	}
	if (broadcasts.length > BROADCAST_DELETE_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
			sessionId,
		});
		return null;
	}

	const mappingRevisions = await ctx.db
		.query("translationMappingRevisions")
		.withIndex("by_session_id_and_revision", (q) =>
			q.eq("sessionId", sessionId),
		)
		.take(MAPPING_REVISION_DELETE_BATCH_SIZE + 1);
	for (const revision of mappingRevisions.slice(
		0,
		MAPPING_REVISION_DELETE_BATCH_SIZE,
	)) {
		await ctx.db.delete("translationMappingRevisions", revision._id);
	}
	if (mappingRevisions.length > MAPPING_REVISION_DELETE_BATCH_SIZE) {
		await ctx.scheduler.runAfter(0, internal.sessions.deleteBatch, {
			sessionId,
		});
		return null;
	}

	await ctx.db.delete("sessions", sessionId);
	return null;
}

export const create = mutation({
	args: {
		title: v.string(),
		...eventFields,
	},
	returns: v.object({ slug: v.string() }),
	handler: async (ctx, args) => atPublicEdge(() => createSession(ctx, args)),
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
			sessions.map((session) => getSessionView(ctx, session)),
		);
	},
});

export const getBySlug = query({
	args: { slug: v.string() },
	returns: v.union(publicSessionValidator, v.null()),
	handler: async (ctx, args) => getPublicBySlug(ctx, args.slug),
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
		return await getSessionView(ctx, session);
	},
});

export const updateDescription = mutation({
	args: {
		sessionId: v.id("sessions"),
		description: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) =>
		atPublicEdge(() => patchDescription(ctx, args.sessionId, args.description)),
});

export const getForAction = internalQuery({
	args: { sessionId: v.id("sessions") },
	returns: v.union(storedSessionValidator, v.null()),
	handler: async (ctx, args) => ctx.db.get("sessions", args.sessionId),
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
	handler: async (ctx, args) =>
		atPublicEdge(() => patchTranslationMappings(ctx, args)),
});

export const updateLanguages = mutation({
	args: {
		sessionId: v.id("sessions"),
		spokenLanguages: v.array(v.string()),
		audienceLanguagesExtra: v.optional(v.array(v.string())),
	},
	returns: v.null(),
	handler: async (ctx, args) => atPublicEdge(() => patchLanguages(ctx, args)),
});

export const updateTitle = mutation({
	args: {
		sessionId: v.id("sessions"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) =>
		atPublicEdge(() => patchTitle(ctx, args.sessionId, args.title)),
});

export const deleteSession = mutation({
	args: {
		sessionId: v.id("sessions"),
	},
	returns: v.null(),
	handler: async (ctx, args) =>
		atPublicEdge(() => removeSession(ctx, args.sessionId)),
});

export const deleteBatch = internalMutation({
	args: { sessionId: v.id("sessions") },
	returns: v.null(),
	handler: async (ctx, args) => deleteSessionBatch(ctx, args.sessionId),
});
