import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function LiveBadge({
	className,
	showDot = true,
}: {
	className?: string;
	showDot?: boolean;
}) {
	return (
		<Badge
			className={cn(
				"shrink-0 gap-1.5 rounded-md bg-echo-live text-echo-live-foreground",
				className,
			)}
		>
			{showDot ? (
				<span
					className="size-2 rounded-full bg-echo-live-foreground/80 animate-pulse"
					aria-hidden
				/>
			) : null}
			LIVE
		</Badge>
	);
}

export function PausedBadge({ className }: { className?: string }) {
	return (
		<Badge variant="secondary" className={cn("shrink-0 rounded-md", className)}>
			Paused
		</Badge>
	);
}

export function ConnectingBadge({ className }: { className?: string }) {
	return (
		<Badge
			variant="outline"
			className={cn("shrink-0 gap-1.5 rounded-full", className)}
		>
			<Loader2 className="size-3 animate-spin" aria-hidden />
			Connecting
		</Badge>
	);
}
