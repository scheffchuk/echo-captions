import { BookText, Check, Copy, MoreHorizontal, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { BroadcastGlossaryPanel } from "@/components/broadcast-glossary-panel";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuItemIcon,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/convex/_generated/dataModel";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getViewerUrl } from "@/lib/viewer-url";
import type { TranslationMapping } from "@/shared/translationMappings";

export function BroadcastLiveExtras({
	slug,
	sessionId,
	initialMappings,
	initialRevisionId,
	audienceCodes,
}: {
	slug: string;
	sessionId: Id<"sessions">;
	initialMappings: TranslationMapping[] | undefined;
	initialRevisionId: Id<"translationMappingRevisions"> | undefined;
	audienceCodes: string[];
}) {
	const [qrOpen, setQrOpen] = useState(false);
	const [glossaryOpen, setGlossaryOpen] = useState(false);
	const viewerUrl = getViewerUrl(slug);
	const { state: copyState, copy } = useCopyToClipboard();
	const copied = copyState === "copied";

	const copyLink = () =>
		copy(
			() => viewerUrl,
			"Viewer link copied",
			"Couldn't copy link. Try again.",
		);

	return (
		<>
			<DropdownMenu presentation="auto">
				<DropdownMenuTrigger
					render={
						<Button
							variant="outline"
							size="sm"
							className="gap-1.5"
							aria-label="More session tools"
						/>
					}
				>
					<MoreHorizontal className="size-4" />
					More
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem value="copy-link" onSelect={() => void copyLink()}>
						<DropdownMenuItemIcon>
							{copied ? (
								<Check className="size-4" />
							) : (
								<Copy className="size-4" />
							)}
						</DropdownMenuItemIcon>
						{copied ? "Copied" : "Copy link"}
					</DropdownMenuItem>
					<DropdownMenuItem value="qr-code" onSelect={() => setQrOpen(true)}>
						<DropdownMenuItemIcon>
							<QrCode className="size-4" />
						</DropdownMenuItemIcon>
						QR code
					</DropdownMenuItem>
					<DropdownMenuItem
						value="glossary"
						onSelect={() => setGlossaryOpen(true)}
					>
						<DropdownMenuItemIcon>
							<BookText className="size-4" />
						</DropdownMenuItemIcon>
						Glossary
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={qrOpen} onOpenChange={setQrOpen} presentation="auto">
				<DialogContent className="max-w-xs">
					<DialogHeader>
						<DialogTitle>Viewer QR code</DialogTitle>
						<DialogDescription>
							Audience can scan this to open captions.
						</DialogDescription>
					</DialogHeader>
					<div className="flex justify-center py-2">
						<QRCodeSVG value={viewerUrl} size={180} />
					</div>
				</DialogContent>
			</Dialog>

			<BroadcastGlossaryPanel
				sessionId={sessionId}
				initialMappings={initialMappings}
				initialRevisionId={initialRevisionId}
				audienceCodes={audienceCodes}
				trigger="none"
				open={glossaryOpen}
				onOpenChange={setGlossaryOpen}
			/>
		</>
	);
}
