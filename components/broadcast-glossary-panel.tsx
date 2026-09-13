"use client";

import { useMutation } from "convex/react";
import { BookText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type StoredTranslationMapping,
	stripMappingIds,
	type TranslationMapping,
	TranslationMappingsField,
	withMappingIds,
} from "@/components/translation-mappings-field";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getPublicConvexError } from "@/lib/expected-errors";
import { cn } from "@/lib/utils";

function mappingsEqual(
	a: TranslationMapping[],
	b: TranslationMapping[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every(
		(mapping, index) =>
			mapping.term === b[index]?.term &&
			mapping.targetLanguage === b[index]?.targetLanguage &&
			mapping.translation === b[index]?.translation,
	);
}

export function BroadcastGlossaryPanel({
	sessionId,
	initialMappings,
	initialRevisionId,
	audienceCodes,
	trigger = "card",
	className,
	open: openProp,
	onOpenChange: onOpenChangeProp,
}: {
	sessionId: Id<"sessions">;
	initialMappings: StoredTranslationMapping[] | undefined;
	initialRevisionId: Id<"translationMappingRevisions"> | undefined;
	audienceCodes: string[];
	trigger?: "card" | "button" | "none";
	className?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const updateTranslationMappings = useMutation(
		api.sessions.updateTranslationMappings,
	);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [conflict, setConflict] = useState(false);
	const [draftRevisionId, setDraftRevisionId] =
		useState<Id<"translationMappingRevisions"> | null>(
			initialRevisionId ?? null,
		);

	const isControlled = openProp !== undefined;
	const open = isControlled ? openProp : uncontrolledOpen;
	const setOpen = (next: boolean) => {
		if (!isControlled) setUncontrolledOpen(next);
		onOpenChangeProp?.(next);
	};

	const savedMappings = useMemo(
		() => withMappingIds(initialMappings),
		[initialMappings],
	);

	const [mappings, setMappings] = useState<TranslationMapping[]>(savedMappings);
	const wasOpenRef = useRef(false);

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			setMappings(savedMappings);
			setDraftRevisionId(initialRevisionId ?? null);
			setConflict(false);
		}
		wasOpenRef.current = open;
	}, [open, savedMappings, initialRevisionId]);

	const isDirty = !mappingsEqual(mappings, savedMappings);

	const discardAndClose = () => {
		setMappings(savedMappings);
		setDraftRevisionId(initialRevisionId ?? null);
		setConflict(false);
		setDiscardOpen(false);
		setOpen(false);
	};

	const handleOpenChange = (next: boolean) => {
		if (next) {
			setMappings(savedMappings);
			setDraftRevisionId(initialRevisionId ?? null);
			setConflict(false);
			setOpen(true);
			return;
		}
		if (isDirty) {
			setDiscardOpen(true);
			return;
		}
		setOpen(false);
	};

	const reload = () => {
		setMappings(savedMappings);
		setDraftRevisionId(initialRevisionId ?? null);
		setConflict(false);
	};

	const save = async () => {
		setSaving(true);
		try {
			await updateTranslationMappings({
				sessionId,
				translationMappings: stripMappingIds(mappings),
				expectedRevisionId: draftRevisionId,
			});
			toast.success("Glossary saved");
			setConflict(false);
			setOpen(false);
		} catch (error) {
			const failure = getPublicConvexError(error, "Couldn't save glossary");
			if (failure.code === "mapping_revision_conflict") {
				setConflict(true);
				toast.error("Glossary changed elsewhere. Reload it before saving.");
				return;
			}
			toast.error(failure.message);
		} finally {
			setSaving(false);
		}
	};

	const termCountLabel =
		savedMappings.length === 0
			? "No terms yet"
			: `${savedMappings.length} term${savedMappings.length === 1 ? "" : "s"}`;

	const triggerNode =
		trigger === "none" ? null : trigger === "button" ? (
			<DialogTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn("gap-1.5", className)}
					aria-label="Glossary"
				>
					<BookText className="size-4" />
					Glossary
				</Button>
			</DialogTrigger>
		) : (
			<div className={cn("rounded-lg border border-border bg-card", className)}>
				<DialogTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/50"
					>
						<BookText className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<h3 className="text-sm font-medium text-foreground">Glossary</h3>
							<p className="mt-0 truncate text-xs text-muted-foreground">
								{termCountLabel}
							</p>
						</div>
					</button>
				</DialogTrigger>
			</div>
		);

	return (
		<>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				{triggerNode}

				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Glossary</DialogTitle>
						<DialogDescription>
							Tell captions how to translate your terms. New lines use these
							after you save.
						</DialogDescription>
					</DialogHeader>

					{open ? (
						<TranslationMappingsField
							key={sessionId}
							mappings={mappings}
							audienceCodes={audienceCodes}
							onChange={setMappings}
							disabled={saving}
						/>
					) : null}
					{conflict ? (
						<div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
							<p role="alert" className="text-destructive">
								This glossary changed in another tab. Reload it to continue.
							</p>
							<Button type="button" variant="outline" onClick={reload}>
								Reload glossary
							</Button>
						</div>
					) : null}

					<DialogFooter className="gap-2">
						<Button
							type="button"
							variant="secondary"
							disabled={saving}
							onClick={() => handleOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={saving || !isDirty || conflict}
							onClick={() => void save()}
						>
							{saving ? "Saving…" : "Save glossary"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Discard glossary changes?</AlertDialogTitle>
						<AlertDialogDescription>
							You have unsaved terms. Closing discards them.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep editing</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={discardAndClose}>
							Discard
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
