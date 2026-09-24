import { PanelRight } from "lucide-react";
import { BroadcastGlossaryPanel } from "@/components/broadcast-glossary-panel";
import { SharePanel } from "@/components/share-panel";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import type { TranslationMapping } from "@/shared/translationMappings";

export function BroadcastSessionTools({
	slug,
	sessionId,
	initialMappings,
	initialRevisionId,
	audienceCodes,
	collapsed,
	className,
	sheetOpen,
	onSheetOpenChange,
}: {
	slug: string;
	sessionId: Id<"sessions">;
	initialMappings: TranslationMapping[] | undefined;
	initialRevisionId: Id<"translationMappingRevisions"> | undefined;
	audienceCodes: string[];
	collapsed: boolean;
	className?: string;
	sheetOpen?: boolean;
	onSheetOpenChange?: (open: boolean) => void;
}) {
	const tools = (
		<div className="flex flex-col gap-4">
			<SharePanel slug={slug} />
			<BroadcastGlossaryPanel
				sessionId={sessionId}
				initialMappings={initialMappings}
				initialRevisionId={initialRevisionId}
				audienceCodes={audienceCodes}
			/>
		</div>
	);

	if (collapsed) {
		return (
			<Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
				<SheetTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className={cn("gap-1.5", className)}
						aria-label="Share and glossary"
					>
						<PanelRight className="size-4" />
						<span className="hidden sm:inline">Share & glossary</span>
					</Button>
				</SheetTrigger>
				<SheetContent
					side="right"
					className="w-full overflow-y-auto sm:max-w-md"
				>
					<SheetHeader>
						<SheetTitle>Share & glossary</SheetTitle>
						<SheetDescription>
							Share the viewer link or edit the glossary.
						</SheetDescription>
					</SheetHeader>
					<div className="mt-8 px-4 pb-4">{tools}</div>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<aside
			className={cn("flex min-h-0 shrink-0 flex-col gap-4 lg:w-72", className)}
		>
			{tools}
		</aside>
	);
}

export function BroadcastSetupHint({
	onOpenSessionTools,
}: {
	onOpenSessionTools?: () => void;
}) {
	const openSessionTools = () => {
		if (onOpenSessionTools) {
			onOpenSessionTools();

			return;
		}

		document
			.getElementById("viewer-link-panel")
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-8 py-12 text-sm text-muted-foreground">
			<div className="w-full max-w-xs text-left">
				<p className="text-title font-medium text-foreground text-balance">
					Ready to go live
				</p>
				<ol className="mt-4 space-y-2">
					<li>1. Select your microphone</li>
					<li>2. Press Go live to start captions</li>
					<li>
						3.{" "}
						<Button
							type="button"
							variant="link"
							className="inline h-auto p-0 text-foreground underline-offset-4 lg:pointer-events-none lg:no-underline"
							onClick={openSessionTools}
						>
							Share the viewer link
						</Button>{" "}
						with your audience
					</li>
				</ol>
			</div>
		</div>
	);
}
