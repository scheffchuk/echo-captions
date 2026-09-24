import { Check, Copy, Link2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { getViewerUrl } from "@/lib/viewer-url";

export function SharePanel({ slug }: { slug: string }) {
	const [copied, setCopied] = useState(false);
	const viewerUrl = getViewerUrl(slug);

	const copyLink = async () => {
		await navigator.clipboard.writeText(viewerUrl);
		setCopied(true);
		toast.success("Viewer link copied");
		setTimeout(() => setCopied(false), 2000);
	};

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
