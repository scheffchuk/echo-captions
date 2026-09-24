import { Check, Copy, Link2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getViewerUrl } from "@/lib/viewer-url";

export function SharePanel({ slug }: { slug: string }) {
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
		<div
			id="viewer-link-panel"
			className="rounded-lg border border-border bg-card"
		>
			<div className="flex w-full items-center gap-4 px-4 py-4">
				<Link2 className="size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<h3 className="text-sm font-medium text-foreground">Viewer link</h3>
					<p className="mt-0 truncate font-mono text-xs text-muted-foreground">
						{viewerUrl}
					</p>
				</div>
				<div className="flex shrink-0 gap-2">
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
					<Popover>
						<PopoverTrigger asChild>
							<Button variant="ghost" size="icon-sm" aria-label="Show QR code">
								<QrCode className="size-4" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-4">
							<QRCodeSVG value={viewerUrl} size={160} />
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}
