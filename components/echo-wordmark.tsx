import { cn } from "@/lib/utils";

export function EchoWordmark({
	className,
	subtitle,
	size = "display",
}: {
	className?: string;
	subtitle?: string;
	size?: "display" | "title";
}) {
	return (
		<div className={cn("space-y-1.5", className)}>
			<p className={size === "display" ? "text-display" : "text-title"}>
				<span className="text-echo-live">Echo</span>
			</p>
			{subtitle ? (
				<p className="max-w-md text-sm text-muted-foreground text-pretty">
					{subtitle}
				</p>
			) : null}
		</div>
	);
}
