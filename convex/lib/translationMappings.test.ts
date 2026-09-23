import { describe, expect, it } from "vitest";
import {
	canonicalizeTranslationMappings,
	MappingValidationError,
	translationDocuments,
} from "./translationMappings";

const audienceLanguages = ["en", "ja", "de"];

function canonicalize(
	mappings: Parameters<typeof canonicalizeTranslationMappings>[0],
) {
	return canonicalizeTranslationMappings(mappings, audienceLanguages);
}

describe("translation mappings", () => {
	it("canonicalizes NFC, outer whitespace, language codes, and row order", async () => {
		expect(
			canonicalize([
				{
					term: "  cafe\u0301 ",
					targetLanguage: "JA-JP",
					translation: "  カフェ  ",
				},
				{ term: "Echo", targetLanguage: "en", translation: " Écho " },
			]),
		).toEqual([
			{ term: "Echo", targetLanguage: "en", translation: "Écho" },
			{ term: "café", targetLanguage: "ja", translation: "カフェ" },
		]);
	});

	it("treats blank rows as no mappings and rejects partially filled rows", async () => {
		expect(
			canonicalize([{ term: "", targetLanguage: "", translation: "" }]),
		).toEqual([]);
		expect(() =>
			canonicalize([
				{ term: "Echo", targetLanguage: "", translation: "エコー" },
			]),
		).toThrow(MappingValidationError);
	});

	it("rejects duplicate case-insensitive term and target pairs", async () => {
		expect(() =>
			canonicalize([
				{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
				{ term: "echo", targetLanguage: "JA", translation: "反響" },
			]),
		).toThrow(MappingValidationError);
	});

	it("counts Unicode characters and enforces the 100/200 limits", async () => {
		expect(() =>
			canonicalize([
				{ term: "😀".repeat(201), targetLanguage: "ja", translation: "x" },
			]),
		).toThrow(MappingValidationError);

		expect(() =>
			canonicalize(
				Array.from({ length: 101 }, (_, index) => ({
					term: `term-${index}`,
					targetLanguage: "ja",
					translation: "x",
				})),
			),
		).toThrow(MappingValidationError);
	});

	it("matches case-insensitively without matching inside letter-number tokens", async () => {
		const mappings = canonicalize([
			{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
		]);

		const [document] = translationDocuments("echo ECHO Echoes", mappings, [
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
		const mappings = canonicalize([
			{ term: "İ", targetLanguage: "ja", translation: "イ" },
		]);

		const [document] = translationDocuments("i\u0307", mappings, ["ja"]);

		expect(document?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"i\u0307",
		]);

		const reverseMappings = canonicalize([
			{ term: "i\u0307", targetLanguage: "ja", translation: "イ" },
		]);

		const [reverseDocument] = translationDocuments("İ", reverseMappings, [
			"ja",
		]);

		expect(reverseDocument?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"İ",
		]);
	});

	it("uses literal matching for scripts without word separators", async () => {
		const mappings = canonicalize([
			{ term: "日本", targetLanguage: "en", translation: "Japan" },
		]);

		const [document] = translationDocuments("日本語と日本", mappings, ["en"]);

		expect(document?.fixedSpans.map((span) => span.sourceText)).toEqual([
			"日本",
			"日本",
		]);
	});

	it("assigns overlap ownership to the longest valid term", async () => {
		const mappings = canonicalize([
			{ term: "New York", targetLanguage: "ja", translation: "ニューヨーク" },
			{ term: "York", targetLanguage: "ja", translation: "ヨーク" },
		]);

		const [document] = translationDocuments(
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
		const mappings = canonicalize([
			{ term: "Echo", targetLanguage: "ja", translation: "エコー" },
		]);

		const documents = translationDocuments("Echo", mappings, ["ja", "de"]);

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

		const [document] = translationDocuments("Echo", mappings, ["ja"]);

		expect(document?.fixedSpans[0]?.replacement).toBe("Echo Prime");
	});
});
