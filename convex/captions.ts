import { vOnCompleteArgs } from "@convex-dev/workpool";
import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { Effect, Layer, ManagedRuntime } from "effect";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { convexConfigLayer } from "./effect/config";
import {
	acceptBroadcastCommit,
	completeBroadcastCommit,
	getOperatorSession,
	retryBroadcastCommit,
	type TargetCompletion,
} from "./lib/broadcastCommits";
import { broadcastErrorCodes } from "./lib/broadcasts";
import { GoogleTranslate } from "./lib/googleTranslate";
import { atPublicEdge } from "./lib/publicEdge";
import { translationDocuments } from "./lib/translationMappings";
import {
	acceptedCommitStatusValidator,
	acceptedCommitTargetStatusValidator,
	segmentStatusValidator,
	translationMappingValidator,
} from "./schema";

const acceptedCommitReceiptValidator = v.object({
	acceptedCommitId: v.id("acceptedCommits"),
	commitId: v.string(),
	status: acceptedCommitStatusValidator,
	sequence: v.number(),
	targetCount: v.number(),
	completedTargetCount: v.number(),
	failedTargetCount: v.number(),
	segmentId: v.union(v.id("segments"), v.null()),
});

const operatorCommitValidator = v.object({
	acceptedCommitId: v.id("acceptedCommits"),
	commitId: v.string(),
	sessionId: v.id("sessions"),
	broadcastId: v.id("broadcasts"),
	broadcastSequence: v.number(),
	commitOrdinal: v.number(),
	sequence: v.number(),
	sourceText: v.string(),
	sourceLanguage: v.string(),
	translationTargets: v.array(v.string()),
	status: acceptedCommitStatusValidator,
	targetCount: v.number(),
	completedTargetCount: v.number(),
	failedTargetCount: v.number(),
	translations: v.record(v.string(), v.string()),
	segmentId: v.union(v.id("segments"), v.null()),
	segmentStatus: v.union(segmentStatusValidator, v.null()),
	error: v.optional(v.string()),
});

const targetTranslationResultValidator = v.union(
	v.object({
		kind: v.literal("translated"),
		targetId: v.id("acceptedCommitTargets"),
		targetLanguage: v.string(),
		translation: v.string(),
	}),
	v.object({
		kind: v.literal("failed"),
		targetId: v.id("acceptedCommitTargets"),
		targetLanguage: v.string(),
		error: v.string(),
	}),
);

const targetContextValidator = v.union(
	v.object({
		targetId: v.id("acceptedCommitTargets"),
		targetLanguage: v.string(),
		sourceText: v.string(),
		sourceLanguage: v.string(),
		status: acceptedCommitTargetStatusValidator,
		mappings: v.union(v.array(translationMappingValidator), v.null()),
	}),
	v.null(),
);

type AcceptedCommit = Doc<"acceptedCommits">;

const runtime = ManagedRuntime.make(
	GoogleTranslate.layer.pipe(Layer.provide(convexConfigLayer)),
);

export const acceptCommit = mutation({
	args: {
		sessionId: v.id("sessions"),
		broadcastId: v.id("broadcasts"),
		commitOrdinal: v.number(),
		commitId: v.string(),
		sourceText: v.string(),
		sourceLanguage: v.string(),
	},
	returns: acceptedCommitReceiptValidator,
	handler: (ctx, args) =>
		atPublicEdge(broadcastErrorCodes, () => acceptBroadcastCommit(ctx, args)),
});

export const retryCommit = mutation({
	args: { acceptedCommitId: v.id("acceptedCommits") },
	returns: acceptedCommitReceiptValidator,
	handler: (ctx, args) => retryBroadcastCommit(ctx, args),
});

async function toOperatorCommit(ctx: QueryCtx, commit: AcceptedCommit) {
	const segment = commit.segmentId
		? await ctx.db.get("segments", commit.segmentId)
		: null;

	const operatorCommit = {
		acceptedCommitId: commit._id,
		commitId: commit.commitId,
		sessionId: commit.sessionId,
		broadcastId: commit.broadcastId,
		broadcastSequence: commit.broadcastSequence,
		commitOrdinal: commit.commitOrdinal,
		sequence: commit.sequence,
		sourceText: commit.sourceText,
		sourceLanguage: commit.sourceLanguage,
		translationTargets: commit.translationTargets,
		status: commit.status,
		targetCount: commit.targetCount,
		completedTargetCount: commit.completedTargetCount,
		failedTargetCount: commit.failedTargetCount,
		translations: segment?.translations ?? {},
		segmentId: commit.segmentId ?? null,
		segmentStatus: segment?.status ?? null,
	};

	const error = commit.error ?? segment?.error;

	if (!error) return operatorCommit;

	return { ...operatorCommit, error };
}

export const listOperatorCommits = query({
	args: {
		sessionId: v.id("sessions"),
		paginationOpts: paginationOptsValidator,
	},
	returns: paginationResultValidator(operatorCommitValidator),
	handler: async (ctx, args) => {
		const session = await getOperatorSession(ctx, args.sessionId);

		const page = await ctx.db
			.query("acceptedCommits")
			.withIndex("by_session_id_and_sequence", (q) =>
				q.eq("sessionId", session._id),
			)
			.order("desc")
			.paginate(args.paginationOpts);

		return {
			...page,
			page: await Promise.all(
				page.page.map((commit) => toOperatorCommit(ctx, commit)),
			),
		};
	},
});

export const getTargetForAction = internalQuery({
	args: { targetId: v.id("acceptedCommitTargets") },
	returns: targetContextValidator,
	handler: async (ctx, args) => {
		const target = await ctx.db.get("acceptedCommitTargets", args.targetId);

		if (!target) return null;
		const commit = await ctx.db.get("acceptedCommits", target.acceptedCommitId);

		if (!commit || target.sessionId !== commit.sessionId) return null;

		const revision = commit.translationMappingRevisionId
			? await ctx.db.get(
					"translationMappingRevisions",
					commit.translationMappingRevisionId,
				)
			: null;

		return {
			targetId: target._id,
			targetLanguage: target.targetLanguage,
			sourceText: commit.sourceText,
			sourceLanguage: commit.sourceLanguage,
			status: target.status,
			mappings: commit.translationMappingRevisionId
				? (revision?.mappings ?? null)
				: [],
		};
	},
});

export const translateTarget = internalAction({
	args: { targetId: v.id("acceptedCommitTargets") },
	returns: targetTranslationResultValidator,
	handler: async (ctx, args): Promise<TargetCompletion> => {
		const target = await ctx.runQuery(
			internal.captions.getTargetForAction,
			args,
		);

		if (!target) {
			return {
				kind: "failed",
				targetId: args.targetId,
				targetLanguage: "unknown",
				error: "Translation target is unavailable",
			};
		}

		const fail = (error: string): TargetCompletion => ({
			kind: "failed",
			targetId: target.targetId,
			targetLanguage: target.targetLanguage,
			error,
		});

		if (target.status !== "pending") {
			return fail("Translation target is no longer pending");
		}

		if (!target.mappings) {
			return fail("Translation mapping revision is unavailable");
		}

		const [document] = translationDocuments(
			target.sourceText,
			target.mappings,
			[target.targetLanguage],
		);

		if (!document) return fail("Translation document is unavailable");

		const program = Effect.gen(function* () {
			const google = yield* GoogleTranslate;

			return yield* google.translateOne(document, target.sourceLanguage);
		}).pipe(
			Effect.map(
				(translation): TargetCompletion => ({
					kind: "translated",
					targetId: target.targetId,
					targetLanguage: target.targetLanguage,
					translation,
				}),
			),
			Effect.catch((error) => Effect.succeed(fail(error.message))),
		);

		return runtime.runPromise(program);
	},
});

export const targetCompleted = internalMutation({
	args: vOnCompleteArgs(
		v.object({ acceptedCommitId: v.id("acceptedCommits") }),
		targetTranslationResultValidator,
	),
	returns: v.null(),
	handler: (ctx, args) => completeBroadcastCommit(ctx, args),
});

export {
	acceptedCommitReceiptValidator,
	operatorCommitValidator,
	targetTranslationResultValidator,
};
