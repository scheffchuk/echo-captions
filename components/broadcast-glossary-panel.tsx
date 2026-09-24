import { useMutation } from "convex/react";
import { BookText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TranslationMappingsField } from "@/components/translation-mappings-field";
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
import type { TranslationMapping } from "@/shared/translationMappings";
import {
	hydrateTranslationMappingDraft,
	isTranslationMappingDraftDirty,
	markTranslationMappingDraftConflict,
	projectTranslationMappingDraft,
	reconcileTranslationMappingDraft,
	type TranslationMappingDraft,
	type TranslationMappingIdFactory,
} from "@/src/lib/translationMappingDraft";

const browserIdFactory: TranslationMappingIdFactory = () => crypto.randomUUID();

type UpdateTranslationMappings = (args: {
	sessionId: Id<"sessions">;
	translationMappings: TranslationMapping[];
	expectedRevisionId: Id<"translationMappingRevisions"> | null;
}) => Promise<{
	revisionId: Id<"translationMappingRevisions"> | null;
	changed: boolean;
}>;

export function BroadcastGlossaryPanel({
	sessionId,
	initialMappings,
	initialRevisionId,
	audienceCodes,
	trigger = "card",
	open: openProp,
	onOpenChange: onOpenChangeProp,
}: {
	sessionId: Id<"sessions">;
	initialMappings: TranslationMapping[] | undefined;
	initialRevisionId: Id<"translationMappingRevisions"> | undefined;
	audienceCodes: string[];
	trigger?: "card" | "none";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const updateTranslationMappings = useMutation(
		api.sessions.updateTranslationMappings,
	);

	return (
		<BroadcastGlossaryPanelView
			sessionId={sessionId}
			initialMappings={initialMappings}
			initialRevisionId={initialRevisionId}
			audienceCodes={audienceCodes}
			trigger={trigger}
			open={openProp}
			onOpenChange={onOpenChangeProp}
			updateTranslationMappings={updateTranslationMappings}
		/>
	);
}

export function BroadcastGlossaryPanelView({
	sessionId,
	initialMappings,
	initialRevisionId,
	audienceCodes,
	trigger = "card",
	open: openProp,
	onOpenChange: onOpenChangeProp,
	updateTranslationMappings,
}: {
	sessionId: Id<"sessions">;
	initialMappings: TranslationMapping[] | undefined;
	initialRevisionId: Id<"translationMappingRevisions"> | undefined;
	audienceCodes: string[];
	trigger?: "card" | "none";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	updateTranslationMappings: UpdateTranslationMappings;
}) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const idFactory = useCallback(browserIdFactory, []);

	const isControlled = openProp !== undefined;
	const open = isControlled ? openProp : uncontrolledOpen;

	const setOpen = (next: boolean) => {
		if (!isControlled) setUncontrolledOpen(next);
		onOpenChangeProp?.(next);
	};

	const hydrateCurrentDraft = useCallback(
		() =>
			hydrateTranslationMappingDraft(
				initialMappings,
				initialRevisionId ?? null,
				idFactory,
			),
		[initialMappings, initialRevisionId, idFactory],
	);

	const [draft, setDraft] = useState<TranslationMappingDraft>(() =>
		hydrateCurrentDraft(),
	);

	const wasOpenRef = useRef(false);

	useEffect(() => {
		if (!open) {
			wasOpenRef.current = false;

			return;
		}

		if (!wasOpenRef.current) {
			setDraft(hydrateCurrentDraft());
			wasOpenRef.current = true;

			return;
		}

		setDraft((current) =>
			reconcileTranslationMappingDraft(
				current,
				initialMappings,
				initialRevisionId ?? null,
				idFactory,
				audienceCodes,
			),
		);
	}, [
		open,
		hydrateCurrentDraft,
		initialMappings,
		initialRevisionId,
		idFactory,
		audienceCodes,
	]);

	const projection = useMemo(
		() => projectTranslationMappingDraft(draft, audienceCodes),
		[draft, audienceCodes],
	);

	const issues = projection.ok ? [] : projection.issues;

	const isDirty = isTranslationMappingDraftDirty(
		draft,
		audienceCodes,
		projection,
	);

	const conflict = draft.conflict;

	const discardAndClose = () => {
		setDraft(hydrateCurrentDraft());
		setDiscardOpen(false);
		setOpen(false);
	};

	const handleOpenChange = (next: boolean) => {
		if (next) {
			setDraft(hydrateCurrentDraft());
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
		setDraft(hydrateCurrentDraft());
	};

	const save = async () => {
		const input = projection;

		if (!input.ok) {
			return;
		}

		setSaving(true);

		try {
			await updateTranslationMappings({
				sessionId,
				translationMappings: input.mappings,
				expectedRevisionId: draft.baseRevisionId,
			});
			toast.success("Glossary saved");
			setOpen(false);
		} catch (error) {
			const failure = getPublicConvexError(error, "Couldn't save glossary");

			if (failure.code === "mapping_revision_conflict") {
				setDraft((current) => markTranslationMappingDraftConflict(current));
				toast.error("Glossary changed elsewhere. Reload it before saving.");

				return;
			}

			toast.error(failure.message);
		} finally {
			setSaving(false);
		}
	};

	const savedMappingCount = initialMappings?.length ?? 0;

	const termCountLabel =
		savedMappingCount === 0
			? "No terms yet"
			: `${savedMappingCount} term${savedMappingCount === 1 ? "" : "s"}`;

	const triggerNode =
		trigger === "none" ? null : (
			<div className="rounded-lg border border-border bg-card">
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
							mappings={draft.rows}
							audienceCodes={audienceCodes}
							issues={issues}
							onChange={(rows) => setDraft((current) => ({ ...current, rows }))}
							disabled={saving}
							idFactory={idFactory}
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
