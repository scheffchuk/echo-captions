import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getViewerUrl } from "@/lib/viewer-url";

export function ShareAudienceDialog({
	slug,
	open,
	onOpenChange,
	onContinue,
}: {
	slug: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onContinue: () => void;
}) {
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Share with audience</DialogTitle>
					<DialogDescription>
						Send this link or QR code so attendees can follow live captions.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
						<div className="min-w-0 flex-1 truncate px-2 py-2 font-mono text-sm">
							{viewerUrl}
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => void copyLink()}
							aria-label={copied ? "Link copied" : "Copy viewer link"}
						>
							{copied ? (
								<Check className="size-4" />
							) : (
								<Copy className="size-4" />
							)}
						</Button>
					</div>
					<div className="flex justify-center rounded-lg border border-border bg-background p-4">
						<QRCodeSVG value={viewerUrl} size={180} />
					</div>
				</div>
				<DialogFooter>
					<Button
						className="bg-echo-live text-echo-live-foreground hover:bg-echo-live/90"
						onClick={onContinue}
					>
						Go to broadcast
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
