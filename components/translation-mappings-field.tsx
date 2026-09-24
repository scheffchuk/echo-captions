import { Plus, X } from "lucide-react";
import { LabelWithHint } from "@/components/label-with-hint";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getCommonLanguageName } from "@/lib/languages";
import {
	addTranslationMappingDraftRow,
	createTranslationMappingDraft,
	removeTranslationMappingDraftRow,
	type TranslationMappingDraftIssue,
	type TranslationMappingDraftRow,
	type TranslationMappingIdFactory,
	updateTranslationMappingDraftRow,
} from "@/src/lib/translationMappingDraft";
import type { StoredTranslationMapping } from "@/src/lib/translationMappings";

const browserIdFactory: TranslationMappingIdFactory = () => crypto.randomUUID();

const issueMessages: Record<TranslationMappingDraftIssue["code"], string> = {
	too_many_mappings: "Remove some mappings before saving.",
	incomplete_row: "Complete this mapping or remove the row.",
	invalid_audience_language: "Choose an Audience language.",
	term_too_long: "Terms must be 200 Unicode characters or fewer.",
	translation_too_long: "Replacements must be 200 Unicode characters or fewer.",
	duplicate_mapping: "This term already has a mapping for this language.",
	conflict: "Reload the glossary before saving.",
};

export function TranslationMappingsField({
	mappings,
	audienceCodes,
	issues = [],
	onChange,
	disabled = false,
	idFactory = browserIdFactory,
}: {
	mappings: ReadonlyArray<TranslationMappingDraftRow>;
	audienceCodes: string[];
	issues?: TranslationMappingDraftIssue[];
	onChange: (mappings: TranslationMappingDraftRow[]) => void;
	disabled?: boolean;
	idFactory?: TranslationMappingIdFactory;
}) {
	const currentDraft = createTranslationMappingDraft({ rows: mappings });

	const updateMapping = (
		id: string,
		patch: Partial<StoredTranslationMapping>,
	) => {
		onChange(updateTranslationMappingDraftRow(currentDraft, id, patch).rows);
	};

	const globalIssues = issues.filter((item) => item.rowId === "$draft");

	return (
		<Field>
			<LabelWithHint
				label="Translation Mappings"
				hint="How a term should translate into each language."
			/>
			{mappings.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					Optional. Add domain terms, or create the event without a glossary.
				</p>
			) : null}
			{globalIssues.length > 0 ? (
				<FieldError>
					{globalIssues.map((item) => issueMessages[item.code]).join(" ")}
				</FieldError>
			) : null}
			<div className="space-y-4">
				{mappings.map((mapping) => (
					<div key={mapping.id} className="space-y-1">
						<div className="flex items-center gap-2">
							<Input
								placeholder="e.g. shici"
								value={mapping.term}
								disabled={disabled}
								aria-invalid={issues.some(
									(item) => item.rowId === mapping.id && item.field === "term",
								)}
								onChange={(event) =>
									updateMapping(mapping.id, { term: event.target.value })
								}
							/>
							<Select
								value={mapping.targetLanguage}
								disabled={disabled}
								onValueChange={(value) =>
									updateMapping(mapping.id, { targetLanguage: value })
								}
							>
								<SelectTrigger className="w-[140px] shrink-0">
									<SelectValue placeholder="Language" />
								</SelectTrigger>
								<SelectContent>
									{audienceCodes.map((code) => (
										<SelectItem key={code} value={code}>
											{getCommonLanguageName(code)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Input
								placeholder="e.g. poetry"
								value={mapping.translation}
								disabled={disabled}
								aria-invalid={issues.some(
									(item) =>
										item.rowId === mapping.id && item.field === "translation",
								)}
								onChange={(event) =>
									updateMapping(mapping.id, { translation: event.target.value })
								}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="shrink-0"
								disabled={disabled}
								aria-label="Remove mapping"
								onClick={() =>
									onChange(
										removeTranslationMappingDraftRow(currentDraft, mapping.id)
											.rows,
									)
								}
							>
								<X className="size-4" />
							</Button>
						</div>
						<FieldError>
							{issues
								.filter((item) => item.rowId === mapping.id)
								.map((item) => issueMessages[item.code])
								.join(" ")}
						</FieldError>
					</div>
				))}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled || audienceCodes.length === 0}
					title={
						audienceCodes.length === 0
							? "Add spoken or audience languages first"
							: undefined
					}
					onClick={() =>
						onChange(
							addTranslationMappingDraftRow(currentDraft, idFactory).rows,
						)
					}
				>
					<Plus className="size-4" />
					Add mapping
				</Button>
			</div>
		</Field>
	);
}
