"use client";

import { CircleHelp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { getCommonLanguageName } from "@/lib/languages";

export type StoredTranslationMapping = {
	term: string;
	targetLanguage: string;
	translation: string;
};

export type TranslationMapping = StoredTranslationMapping & {
	id: string;
};

export function createEmptyMapping(): TranslationMapping {
	return {
		id: crypto.randomUUID(),
		term: "",
		targetLanguage: "",
		translation: "",
	};
}

function stableMappingId(
	mapping: StoredTranslationMapping,
	index: number,
): string {
	return `saved-${index}-${mapping.term}\u0001${mapping.targetLanguage}\u0001${mapping.translation}`;
}

export function withMappingIds(
	mappings: StoredTranslationMapping[] | undefined,
): TranslationMapping[] {
	return (mappings ?? []).map((mapping, index) => ({
		...mapping,
		id: stableMappingId(mapping, index),
	}));
}

export function stripMappingIds(
	mappings: TranslationMapping[],
): StoredTranslationMapping[] {
	return mappings.map(({ term, targetLanguage, translation }) => ({
		term,
		targetLanguage,
		translation,
	}));
}

function FieldHint({ content }: { content: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					tabIndex={-1}
					className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
					aria-label={content}
				>
					<CircleHelp className="size-4" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="right" className="max-w-56">
				{content}
			</TooltipContent>
		</Tooltip>
	);
}

function LabelWithHint({
	htmlFor,
	label,
	hint,
}: {
	htmlFor?: string;
	label: string;
	hint: string;
}) {
	return (
		<FieldLabel htmlFor={htmlFor} className="inline-flex items-center gap-2">
			{label}
			<FieldHint content={hint} />
		</FieldLabel>
	);
}

export function TranslationMappingsField({
	mappings,
	audienceCodes,
	onChange,
	disabled = false,
}: {
	mappings: TranslationMapping[];
	audienceCodes: string[];
	onChange: (mappings: TranslationMapping[]) => void;
	disabled?: boolean;
}) {
	const updateMapping = (
		id: string,
		patch: Partial<StoredTranslationMapping>,
	) => {
		onChange(
			mappings.map((mapping) =>
				mapping.id === id ? { ...mapping, ...patch } : mapping,
			),
		);
	};

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
			<div className="space-y-4">
				{mappings.map((mapping) => (
					<div key={mapping.id} className="flex items-center gap-2">
						<Input
							placeholder="e.g. shici"
							value={mapping.term}
							disabled={disabled}
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
								onChange(mappings.filter((item) => item.id !== mapping.id))
							}
						>
							<X className="size-4" />
						</Button>
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
					onClick={() => onChange([...mappings, createEmptyMapping()])}
				>
					<Plus className="size-4" />
					Add mapping
				</Button>
			</div>
		</Field>
	);
}
