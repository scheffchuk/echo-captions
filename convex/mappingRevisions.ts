import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { translationMappingRevisionDocValidator } from "./schema";

export const getForAction = internalQuery({
	args: { revisionId: v.id("translationMappingRevisions") },
	returns: v.union(translationMappingRevisionDocValidator, v.null()),
	handler: (ctx, args) =>
		ctx.db.get("translationMappingRevisions", args.revisionId),
});
