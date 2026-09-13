import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OperatorChrome({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("relative min-h-dvh bg-background", className)}>
			{children}
		</div>
	);
}
