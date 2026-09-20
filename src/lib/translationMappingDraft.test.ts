import { describe, expect, it } from "vitest";
import {
	addTranslationMappingDraftRow,
	createTranslationMappingDraft,
	hydrateTranslationMappingDraft,
	isTranslationMappingDraftDirty,
	markTranslationMappingDraftConflict,
	reconcileTranslationMappingDraft,
	removeTranslationMappingDraftRow,
	type TranslationMappingDraft,
	toCreateInput,
	toUpdateInput,
	updateTranslationMappingDraftRow,
	validateTranslationMappingDraft,
} from "./translationMappingDraft";

const audienceCodes = ["en", "ja"];

const savedMappings = [
	{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
];

function ids(...values: string[]) {
	let index = 0;
	return () => values[index++] ?? `generated-${index}`;
}

function draftWithRows(
	rows: TranslationMappingDraft["rows"],
): TranslationMappingDraft {
	return createTranslationMappingDraft({ rows });
}

describe("translation mapping draft", () => {
	it("assigns opaque IDs once and keeps them through row edits", () => {
		const draft = hydrateTranslationMappingDraft(
			savedMappings,
			"revision-1",
			ids("saved-1"),
		);
		const rowId = draft.rows[0]?.id;
		if (!rowId) throw new Error("expected a hydrated row");

		const added = addTranslationMappingDraftRow(draft, ids("new-1"));
		const edited = updateTranslationMappingDraftRow(added, rowId, {
			translation: "Echo Prime",
		});
		const removed = removeTranslationMappingDraftRow(edited, "new-1");

		expect(removed.rows).toEqual([
			{
				id: "saved-1",
				term: "Echo",
				targetLanguage: "ja",
				translation: "Echo Prime",
			},
		]);
	});

	it("reports row-level issues while retaining rows outside the audience", () => {
		const draft = validateTranslationMappingDraft(
			draftWithRows([
				{ id: "empty", term: "", targetLanguage: "", translation: "" },
				{
					id: "original",
					term: "Echo",
					targetLanguage: "ja",
					translation: "エコー",
				},
				{ id: "partial", term: "Echo", targetLanguage: "ja", translation: "" },
				{
					id: "removed-language",
					term: "Word",
					targetLanguage: "de",
					translation: "Wort",
				},
				{
					id: "duplicate",
					term: "echo",
					targetLanguage: "JA",
					translation: "反響",
				},
			]),
			audienceCodes,
		);

		expect(draft.rows).toHaveLength(5);
		expect(draft.issues).toEqual(
			expect.arrayContaining([
				{ rowId: "partial", field: "translation", code: "incomplete_row" },
				{
					rowId: "removed-language",
					field: "targetLanguage",
					code: "invalid_audience_language",
				},
				{ rowId: "duplicate", field: "term", code: "duplicate_mapping" },
			]),
		);
		expect(draft.issues).not.toEqual(
			expect.arrayContaining([
				{ rowId: "empty", field: "term", code: "incomplete_row" },
			]),
		);
	});

	it("projects valid rows canonically and omits an empty editor row", () => {
		const draft = draftWithRows([
			{ id: "empty", term: "", targetLanguage: "", translation: "" },
			{
				id: "mapping",
				term: "  cafe\u0301 ",
				targetLanguage: "JA-JP",
				translation: "  カフェ ",
			},
		]);

		expect(toCreateInput(draft, audienceCodes)).toEqual({
			ok: true,
			mappings: [{ term: "café", targetLanguage: "ja", translation: "カフェ" }],
		});
		expect(toUpdateInput(draft, audienceCodes)).toEqual({
			ok: true,
			mappings: [{ term: "café", targetLanguage: "ja", translation: "カフェ" }],
		});
	});

	it("compares canonical content instead of editor row order", () => {
		const baseMappings = [
			{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
			{ term: "Word", targetLanguage: "en", translation: "term" },
		];
		const draft = createTranslationMappingDraft({
			rows: [
				{ id: "word", ...baseMappings[1] },
				{
					id: "echo",
					term: " Echo ",
					targetLanguage: "JA",
					translation: " エコー ",
				},
			],
			baseMappings,
			baseRevisionId: "revision-1",
		});

		expect(isTranslationMappingDraftDirty(draft, audienceCodes)).toBe(false);
		expect(
			toUpdateInput(createTranslationMappingDraft(), audienceCodes),
		).toEqual({
			ok: true,
			mappings: [],
		});
	});

	it("rejects partial rows in both persistence projections", () => {
		const draft = draftWithRows([
			{ id: "partial", term: "Echo", targetLanguage: "ja", translation: "" },
		]);

		expect(toCreateInput(draft, audienceCodes)).toEqual({
			ok: false,
			issues: [
				{ rowId: "partial", field: "translation", code: "incomplete_row" },
			],
		});
		expect(toUpdateInput(draft, audienceCodes)).toEqual({
			ok: false,
			issues: [
				{ rowId: "partial", field: "translation", code: "incomplete_row" },
			],
		});
	});

	it("reconciles clean drafts and marks dirty drafts as conflicts without merging", () => {
		const clean = hydrateTranslationMappingDraft(
			savedMappings,
			"revision-1",
			ids("saved-1"),
		);
		const latest = [{ term: "New", targetLanguage: "ja", translation: "新" }];
		const rebased = reconcileTranslationMappingDraft(
			clean,
			latest,
			"revision-2",
			ids("latest-1"),
		);

		expect(rebased).toMatchObject({
			rows: [{ id: "latest-1", ...latest[0] }],
			baseRevisionId: "revision-2",
			conflict: false,
		});

		const dirty = updateTranslationMappingDraftRow(clean, "saved-1", {
			translation: "Local change",
		});
		const conflicted = reconcileTranslationMappingDraft(
			dirty,
			latest,
			"revision-2",
			ids("unused"),
		);

		expect(conflicted).toMatchObject({
			rows: [{ id: "saved-1", translation: "Local change" }],
			baseRevisionId: "revision-1",
			conflict: true,
		});
		expect(markTranslationMappingDraftConflict(dirty).conflict).toBe(true);
	});

	it("retains a mapping invalidated by an Audience language removal", () => {
		const draft = hydrateTranslationMappingDraft(
			savedMappings,
			"revision-1",
			ids("saved-1"),
		);
		const reconciled = reconcileTranslationMappingDraft(
			draft,
			[],
			"revision-2",
			ids("retained-1"),
			["en"],
		);

		expect(reconciled).toMatchObject({
			rows: [{ id: "retained-1", ...savedMappings[0] }],
			baseMappings: [],
			conflict: false,
		});
		expect(validateTranslationMappingDraft(reconciled, ["en"]).issues).toEqual([
			{
				rowId: "retained-1",
				field: "targetLanguage",
				code: "invalid_audience_language",
			},
		]);
	});
});
