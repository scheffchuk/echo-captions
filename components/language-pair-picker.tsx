"use client";

import { Check, ChevronDown } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	formatLanguageLabelCompact,
	formatLanguagePairLabel,
	formatLanguagePairLabelCompact,
	getCommonLanguageName,
	type LanguagePair,
} from "@/lib/languages";
import { cn } from "@/lib/utils";

const MAX_DISPLAY_LANGUAGES = 2;

function pairLabel(pair: LanguagePair, compact: boolean): string {
	if (pair.length === 2) {
		return compact
			? formatLanguagePairLabelCompact(pair)
			: formatLanguagePairLabel(pair);
	}

	return compact
		? formatLanguageLabelCompact(pair[0])
		: getCommonLanguageName(pair[0]);
}

export function LanguagePairPicker({
	languages,
	pair,
	onChange,
	size = "default",
	compact = false,
	mode = "pair",
	className,
}: {
	languages: string[];
	pair: LanguagePair;
	onChange: (pair: LanguagePair) => void;
	size?: ComponentProps<typeof Button>["size"];
	compact?: boolean;
	/** `audience`: single-select primary + optional second language. `pair`: multi toggle. */
	mode?: "pair" | "audience";
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [pickingTranslation, setPickingTranslation] = useState(false);
	const selected = pair.length === 2 ? pair : [pair[0]];
	const canPickTwo = languages.length >= MAX_DISPLAY_LANGUAGES;
	const isDual = pair.length === 2;
	const translationChoices = languages.filter((code) => code !== pair[0]);

	const toggleLanguage = (code: string) => {
		if (!canPickTwo) {
			onChange([code]);
			setOpen(false);

			return;
		}

		if (selected.includes(code)) {
			const next = selected.filter((item) => item !== code);

			if (next.length === 0) return;
			onChange(next.length === 2 ? [next[0], next[1]] : [next[0]]);

			return;
		}

		if (selected.length === 1) {
			onChange([selected[0], code]);
			setOpen(false);

			return;
		}

		onChange([selected[0], code]);
		setOpen(false);
	};

	const selectAudienceLanguage = (code: string) => {
		onChange([code]);
		setPickingTranslation(false);
		setOpen(false);
	};

	const selectTranslation = (code: string) => {
		if (code === pair[0]) return;
		onChange([pair[0], code]);
		setPickingTranslation(false);
		setOpen(false);
	};

	const hideTranslation = () => {
		onChange([pair[0]]);
		setPickingTranslation(false);
	};

	if (languages.length === 0) return null;

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);

				if (!next) setPickingTranslation(false);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size={size}
					className={cn(
						"justify-between border-border bg-background font-normal",
						compact ? "w-auto" : "min-w-[160px]",
						className,
					)}
					aria-label={mode === "audience" ? "Language" : "Display languages"}
				>
					<span className="truncate">{pairLabel(pair, compact)}</span>
					<ChevronDown className="size-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-max min-w-48 p-2">
				{mode === "audience" ? (
					<div className="flex flex-col gap-1">
						{pickingTranslation ? (
							<>
								<p className="px-2 py-1 text-xs text-muted-foreground">
									Also show
								</p>
								{translationChoices.map((code) => (
									<button
										key={code}
										type="button"
										onClick={() => selectTranslation(code)}
										className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
									>
										{getCommonLanguageName(code)}
									</button>
								))}
								<button
									type="button"
									onClick={() => setPickingTranslation(false)}
									className="mt-1 min-h-11 px-2 py-1.5 text-left text-sm text-muted-foreground hover:text-foreground"
								>
									Back
								</button>
							</>
						) : (
							<>
								<p className="px-2 py-1 text-xs text-muted-foreground">
									Your language
								</p>
								{languages.map((code) => {
									const isPrimary = pair[0] === code;

									return (
										<button
											key={code}
											type="button"
											onClick={() => selectAudienceLanguage(code)}
											className={cn(
												"flex min-h-11 items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
												isPrimary && "bg-accent",
											)}
										>
											<span className="flex size-4 items-center justify-center">
												{isPrimary ? <Check className="size-3.5" /> : null}
											</span>
											{getCommonLanguageName(code)}
										</button>
									);
								})}
								{canPickTwo ? (
									<div className="mt-1 border-t border-border pt-1">
										{isDual ? (
											<button
												type="button"
												onClick={hideTranslation}
												className="flex min-h-11 w-full items-center px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
											>
												Hide {getCommonLanguageName(pair[1])}
											</button>
										) : (
											<button
												type="button"
												onClick={() => setPickingTranslation(true)}
												className="flex min-h-11 w-full items-center px-2 py-1.5 text-left text-sm hover:bg-accent"
											>
												Show translation too
											</button>
										)}
									</div>
								) : null}
							</>
						)}
					</div>
				) : (
					<>
						{canPickTwo && (
							<p className="mb-1 whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">
								Choose up to 2 languages
							</p>
						)}
						<div className="flex flex-col gap-1">
							{languages.map((code) => {
								const isSelected = selected.includes(code);

								return (
									<button
										key={code}
										type="button"
										onClick={() => toggleLanguage(code)}
										className={cn(
											"flex items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
											isSelected && "bg-accent",
										)}
									>
										<span className="flex size-4 items-center justify-center">
											{isSelected ? <Check className="size-3.5" /> : null}
										</span>
										{getCommonLanguageName(code)}
									</button>
								);
							})}
						</div>
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
