import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageLoading({ message = "Loading…" }: { message?: string }) {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background">
			<p className="text-muted-foreground">{message}</p>
		</main>
	);
}

export function CaptionFeedSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn("flex flex-col gap-3 p-4", className)}>
			<Skeleton className="h-5 w-4/5" />
			<Skeleton className="h-5 w-3/5" />
			<Skeleton className="h-5 w-2/3" />
		</div>
	);
}

export function SessionNotFound({
	title = "Session not found",
	description = "This link may be wrong or the session was deleted.",
	variant = "operator",
}: {
	title?: string;
	description?: string;
	/** Audience sees host-facing recovery copy; operators get a dashboard link. */
	variant?: "operator" | "audience";
}) {
	const audienceDescription =
		description === "This link may be wrong or the session was deleted."
			? "Check the link with your host, or ask them to share it again."
			: description;

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
			<p className="text-title">{title}</p>
			<p className="max-w-sm text-sm text-muted-foreground text-pretty">
				{variant === "audience" ? audienceDescription : description}
			</p>
			{variant === "operator" ? (
				<Link
					to="/"
					className="mt-4 text-sm font-medium text-foreground underline-offset-4 hover:underline"
				>
					Back to dashboard
				</Link>
			) : null}
		</main>
	);
}

export function DashboardEmptyState({ children }: { children?: ReactNode }) {
	return (
		<div className="rounded-xl border border-dashed border-border bg-muted/30 px-8 py-14 text-center">
			<p className="text-title">No events</p>
			{children ? (
				<div className="mt-6 flex justify-center">{children}</div>
			) : null}
		</div>
	);
}

export function SessionGridSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			{["sk-a", "sk-b", "sk-c"].map((key) => (
				<div
					key={key}
					className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
				>
					<div className="space-y-2">
						<Skeleton className="h-5 w-3/5" />
						<Skeleton className="h-3 w-4/5" />
					</div>
					<div className="flex gap-2">
						<Skeleton className="h-8 w-20 rounded-lg" />
						<Skeleton className="h-8 w-24 rounded-lg" />
						<Skeleton className="h-8 w-24 rounded-lg" />
					</div>
				</div>
			))}
		</div>
	);
}
