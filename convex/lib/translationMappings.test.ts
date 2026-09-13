import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	canonicalizeTranslationMappings,
	MappingValidationError,
	makeTranslationDocuments,
} from "./translationMappings";

const audienceLanguages = ["en", "ja", "de"];

function canonicalize(
	mappings: Parameters<typeof canonicalizeTranslationMappings>[0],
) {
	return Effect.runPromise(
		canonicalizeTranslationMappings(mappings, audienceLanguages),
	);
}

describe("translation mappings", () => {
	it("canonicalizes NFC, outer whitespace, language codes, and row order", async () => {
		await expect(
			canonicalize([
				{
					term: "  cafe\u0301 ",
					targetLanguage: "JA-JP",
					translation: "  カフェ  ",
				},
				{ term: "Echo", targetLanguage: "en", translation: " Écho " },
			]),
		).resolves.toEqual([
			{ term: "Echo", targetLanguage: "en", translation: "Écho" },
			{ term: "café", targetLanguage: "ja", translation: "カフェ" },
		]);
	});

	it("treats blank rows as no mappings and rejects partially filled rows", async () => {
		await expect(
			canonicalize([{ term: "", targetLanguage: "", translation: "" }]),
		).resolves.toEqual([]);
		await expect(
			canonicalize([
				{ term: "Echo", targetLanguage: "", translation: "エコー" },
			]),
		).rejects.toBeInstanceOf(MappingValidationError);
	});

	it("rejects duplicate case-insensitive term and target pairs", async () => {
		await expect(
			canonicalize([
				{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
				{ term: "echo", targetLanguage: "JA", translation: "反響" },
			]),
		).rejects.toBeInstanceOf(MappingValidationError);
	});

	it("counts Unicode characters and enforces the 100/200 limits", async () => {
		await expect(
			canonicalize([
				{ term: "😀".repeat(201), targetLanguage: "ja", translation: "x" },
			]),
		).rejects.toBeInstanceOf(MappingValidationError);

		await expect(
			canonicalize(
				Array.from({ length: 101 }, (_, index) => ({
					term: `term-${index}`,
					targetLanguage: "ja",
					translation: "x",
				})),
			),
		).rejects.toBeInstanceOf(MappingValidationError);
	});

	it("matches case-insensitively without matching inside letter-number tokens", async () => {
		const mappings = await canonicalize([
			{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
		]);
		const [document] = makeTranslationDocuments("echo ECHO Echoes", mappings, [
			"ja",
		]);

		expect(document?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"echo",
			"ECHO",
		]);
		expect(document?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"echo",
			"ECHO",
		]);
		expect(
			document?.spans
				.filter((span) => span.kind === "text")
				.map((span) => span.text)
				.join(""),
		).toBe("  Echoes");
	});

	it("handles case folds that expand to multiple Unicode code points", async () => {
		const mappings = await canonicalize([
			{ term: "İ", targetLanguage: "ja", translation: "イ" },
		]);
		const [document] = makeTranslationDocuments("i\u0307", mappings, ["ja"]);

		expect(document?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"i\u0307",
		]);

		const reverseMappings = await canonicalize([
			{ term: "i\u0307", targetLanguage: "ja", translation: "イ" },
		]);
		const [reverseDocument] = makeTranslationDocuments("İ", reverseMappings, [
			"ja",
		]);
		expect(reverseDocument?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"İ",
		]);
	});

	it("uses literal matching for scripts without word separators", async () => {
		const mappings = await canonicalize([
			{ term: "日本", targetLanguage: "en", translation: "Japan" },
		]);
		const [document] = makeTranslationDocuments("日本語と日本", mappings, [
			"en",
		]);

		expect(document?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"日本",
			"日本",
		]);
	});

	it("assigns overlap ownership to the longest valid term", async () => {
		const mappings = await canonicalize([
			{ term: "New York", targetLanguage: "ja", translation: "ニューヨーク" },
			{ term: "York", targetLanguage: "ja", translation: "ヨーク" },
		]);
		const [document] = makeTranslationDocuments(
			"New York is bigger than York",
			mappings,
			["ja"],
		);

		expect(document?.fixedSpans.map((span) => span.replacement)).toEqual([
			"ニューヨーク",
			"ヨーク",
		]);
	});

	it("keeps mappings target-specific and uses plain text for no-match targets", async () => {
		const mappings = await canonicalize([
			{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
		]);
		const documents = makeTranslationDocuments("Echo", mappings, ["ja", "de"]);

		expect(documents[0]).toMatchObject({ targetLanguage: "ja" });
		expect(documents[0]?.fixedSpans).toHaveLength(1);
		expect(documents[1]).toEqual({
			targetLanguage: "de",
			spans: [{ kind: "text", text: "Echo" }],
			fixedSpans: [],
		});
	});

	it("does not recursively apply a replacement", async () => {
		const mappings = await canonicalize([
			{ term: "Echo", targetLanguage: "ja", translation: "Echo Prime" },
			{ term: "Prime", targetLanguage: "ja", translation: "二次" },
		]);
		const [document] = makeTranslationDocuments("Echo", mappings, ["ja"]);

		expect(document?.fixedSpans[0]?.replacement).toBe("Echo Prime");
	});
});
