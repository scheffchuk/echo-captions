import { Link, useNavigate } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
	Check,
	Copy,
	KeyRound,
	Link2,
	LogOut,
	Search,
	Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ChangePasswordForm } from "@/components/change-password-form";
import { CreateEventForm } from "@/components/create-event-form";
import { EchoWordmark } from "@/components/echo-wordmark";
import { LiveBadge } from "@/components/live-badge";
import {
	DashboardEmptyState,
	SessionGridSkeleton,
} from "@/components/loading-states";
import { OperatorChrome } from "@/components/operator-chrome";
import { ShareAudienceDialog } from "@/components/share-audience-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	AlertDialog,
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
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getPublicConvexError } from "@/lib/expected-errors";
import { getCommonLanguageName } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { getViewerUrl } from "@/lib/viewer-url";
import { useOperatorAuth } from "../src/lib/auth/operator";

type DashboardSession = Doc<"sessions"> & { isLive: boolean };

function formatSessionDate(timestamp: number | undefined) {
	if (!timestamp) return null;

	return new Date(timestamp).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatLastActivity(timestamp: number | undefined) {
	if (!timestamp) return null;

	return `Active ${new Date(timestamp).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	})}`;
}

function formatLanguages(codes: string[]) {
	if (codes.length === 0) return "No languages";

	if (codes.length <= 3) {
		return codes.map(getCommonLanguageName).join(" · ");
	}

	return `${codes
		.slice(0, 2)
		.map(getCommonLanguageName)
		.join(" · ")} · +${codes.length - 2}`;
}

function formatSessionMeta(
	session: DashboardSession,
	opts?: { live?: boolean },
) {
	const parts = [
		formatSessionDate(session.eventDate),
		formatLanguages(session.audienceLanguages),
		opts?.live
			? null
			: formatLastActivity(session.lastActivityAt ?? session._creationTime),
	].filter(Boolean);

	return parts.join(" · ");
}

function sortSessions(sessions: Array<DashboardSession>) {
	return [...sessions].sort((a, b) => {
		if (a.isLive !== b.isLive) {
			return a.isLive ? -1 : 1;
		}

		const aTime = a.lastActivityAt ?? a._creationTime;
		const bTime = b.lastActivityAt ?? b._creationTime;

		return bTime - aTime;
	});
}

function matchesQuery(session: DashboardSession, query: string) {
	const q = query.trim().toLowerCase();

	if (!q) return true;

	return session.title.toLowerCase().includes(q);
}

function SessionActions({
	session,
	compact,
	deleting,
	onDelete,
}: {
	session: DashboardSession;
	compact: boolean;
	deleting: boolean;
	onDelete: () => void;
}) {
	const convex = useConvex();
	const link = useCopyToClipboard();
	const transcript = useCopyToClipboard();
	const labelClass = compact ? "sr-only sm:not-sr-only" : undefined;

	return (
		<>
			<Button
				size="sm"
				variant={compact ? "ghost" : "outline"}
				disabled={deleting || link.state === "copying"}
				onClick={() =>
					void link.copy(
						() => getViewerUrl(session.slug),
						"Link copied",
						"Couldn't copy link. Try again.",
					)
				}
			>
				{link.state === "copied" ? (
					<Check className="size-4" />
				) : (
					<Link2 className="size-4" />
				)}
				<span className={labelClass}>Share</span>
			</Button>
			<Button
				size="sm"
				variant="ghost"
				disabled={deleting || transcript.state === "copying"}
				onClick={() =>
					void transcript.copy(
						() =>
							convex.query(api.segments.transcriptText, {
								sessionId: session._id,
							}),
						"Copied",
						"Couldn't copy transcript. Try again.",
					)
				}
			>
				{transcript.state === "copied" ? (
					<Check className="size-4" />
				) : (
					<Copy className="size-4" />
				)}
				<span className={labelClass}>Transcript</span>
			</Button>
			<Button
				size="sm"
				variant="ghost"
				className="text-muted-foreground hover:text-destructive"
				disabled={deleting}
				onClick={onDelete}
			>
				<Trash2 className="size-4" />
				<span className={compact ? "sr-only" : undefined}>Delete</span>
			</Button>
		</>
	);
}

function LiveLaunchpad({
	session,
	actions,
}: {
	session: DashboardSession;
	actions: ReactNode;
}) {
	return (
		<article className="flex flex-col gap-6 rounded-2xl bg-echo-live/8 p-6 ring-2 ring-echo-live/40 dark:bg-echo-live/15">
			<div className="space-y-2">
				<LiveBadge />
				<h3 className="text-title text-balance">{session.title}</h3>
				<p className="text-sm text-muted-foreground text-pretty">
					{formatSessionMeta(session, { live: true })}
				</p>
			</div>

			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
				<Button
					size="lg"
					className="bg-echo-live text-echo-live-foreground hover:bg-echo-live/90 sm:min-w-56"
					asChild
				>
					<Link to="/broadcast/$slug" params={{ slug: session.slug }}>
						Continue
					</Link>
				</Button>
				<div className="flex flex-wrap gap-2">{actions}</div>
			</div>
		</article>
	);
}

function IdleSessionRow({
	session,
	actions,
}: {
	session: DashboardSession;
	actions: ReactNode;
}) {
	return (
		<article className="flex flex-col gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/8 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
			<div className="min-w-0 space-y-1">
				<Link
					to="/broadcast/$slug"
					params={{ slug: session.slug }}
					className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
				>
					{session.title}
				</Link>
				<p className="truncate text-xs text-muted-foreground">
					{formatSessionMeta(session)}
				</p>
			</div>
			<div className="flex flex-wrap gap-1.5 sm:shrink-0">
				<Button size="sm" variant="secondary" asChild>
					<Link to="/broadcast/$slug" params={{ slug: session.slug }}>
						Open
					</Link>
				</Button>
				{actions}
			</div>
		</article>
	);
}

export function Dashboard() {
	const { changePassword, signOut } = useOperatorAuth();
	const [passwordOpen, setPasswordOpen] = useState(false);
	const sessions = useQuery(api.sessions.listMine);
	const deleteSession = useMutation(api.sessions.deleteSession);

	const [sessionToDelete, setSessionToDelete] = useState<{
		id: Id<"sessions">;
		title: string;
	} | null>(null);

	const [deletingSessionId, setDeletingSessionId] =
		useState<Id<"sessions"> | null>(null);

	const [searchQuery, setSearchQuery] = useState("");

	const navigate = useNavigate();
	// Kept separate from shareOpen so the dialog content survives its close animation.
	const [createdSlug, setCreatedSlug] = useState<string | null>(null);
	const [shareOpen, setShareOpen] = useState(false);

	const showShare = (slug: string) => {
		setCreatedSlug(slug);
		setShareOpen(true);
	};

	const sortedSessions = sessions ? sortSessions(sessions) : undefined;

	const filteredSessions = sortedSessions?.filter((s) =>
		matchesQuery(s, searchQuery),
	);

	const liveSessions = filteredSessions?.filter((s) => s.isLive) ?? [];
	const idleSessions = filteredSessions?.filter((s) => !s.isLive) ?? [];
	const isLaunchpad = liveSessions.length > 0;
	const primaryLive = liveSessions[0];
	const otherLive = liveSessions.slice(1);

	const confirmDelete = async () => {
		if (!sessionToDelete) return;

		setDeletingSessionId(sessionToDelete.id);

		try {
			await deleteSession({ sessionId: sessionToDelete.id });
			setSessionToDelete(null);
			toast.success("Deleted");
		} catch (err) {
			toast.error(
				getPublicConvexError(err, "Couldn't delete event. Try again.").message,
			);
		} finally {
			setDeletingSessionId(null);
		}
	};

	const sessionActions = (session: DashboardSession, compact: boolean) => (
		<SessionActions
			session={session}
			compact={compact}
			deleting={deletingSessionId === session._id}
			onDelete={() =>
				setSessionToDelete({ id: session._id, title: session.title })
			}
		/>
	);

	return (
		<OperatorChrome>
			<main className="min-h-dvh p-4 md:p-8">
				<Toaster />
				<div className="mx-auto max-w-3xl space-y-10">
					<header className="flex items-start justify-between gap-4">
						<EchoWordmark size="title" />
						<div className="flex shrink-0 items-center gap-2">
							<ThemeToggle />
							<Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
								<DialogTrigger asChild>
									<Button variant="outline" size="sm">
										<KeyRound className="size-4" />
										<span className="sr-only sm:not-sr-only sm:ml-2">
											Password
										</span>
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Change password</DialogTitle>
									</DialogHeader>
									<ChangePasswordForm
										onChangePassword={changePassword}
										onDone={() => {
											setPasswordOpen(false);
											toast.success("Password updated");
										}}
									/>
								</DialogContent>
							</Dialog>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void signOut()}
							>
								<LogOut className="size-4" />
								<span className="sr-only sm:not-sr-only sm:ml-2">Sign out</span>
							</Button>
						</div>
					</header>

					<section className="min-w-0 space-y-5">
						{sessions === undefined ? (
							<SessionGridSkeleton />
						) : sessions === null ? null : sessions.length === 0 ? (
							<DashboardEmptyState>
								<CreateEventForm onCreated={showShare} />
							</DashboardEmptyState>
						) : (
							<>
								{isLaunchpad && primaryLive ? (
									<div className="space-y-4">
										<div className="flex items-center justify-end">
											<CreateEventForm
												triggerVariant="outline"
												onCreated={showShare}
											/>
										</div>
										<LiveLaunchpad
											session={primaryLive}
											actions={sessionActions(primaryLive, false)}
										/>
										{otherLive.map((session) => (
											<LiveLaunchpad
												key={session._id}
												session={session}
												actions={sessionActions(session, false)}
											/>
										))}
									</div>
								) : (
									<div className="flex items-center justify-between gap-4">
										<h2 className="text-title">Events</h2>
										<CreateEventForm onCreated={showShare} />
									</div>
								)}

								{(idleSessions.length > 0 ||
									searchQuery.trim() ||
									(sortedSessions?.length ?? 0) > 3) && (
									<div
										className={cn(
											"space-y-3",
											isLaunchpad && "border-t border-border pt-8",
										)}
									>
										{(sortedSessions?.length ?? 0) > 3 || searchQuery.trim() ? (
											<div className="relative w-full sm:max-w-xs sm:ml-auto">
												<Search
													className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
													aria-hidden
												/>
												<Input
													type="search"
													value={searchQuery}
													onChange={(e) => setSearchQuery(e.target.value)}
													placeholder="Search…"
													className="pl-8"
													aria-label="Search events"
												/>
											</div>
										) : isLaunchpad ? (
											<p className="text-sm font-medium text-muted-foreground">
												Events
											</p>
										) : null}

										{idleSessions.length === 0 && searchQuery.trim() ? (
											<p className="text-sm text-muted-foreground">
												No matches.
											</p>
										) : (
											<div className="flex flex-col gap-2">
												{idleSessions.map((session) => (
													<IdleSessionRow
														key={session._id}
														session={session}
														actions={sessionActions(session, true)}
													/>
												))}
											</div>
										)}
									</div>
								)}
							</>
						)}
					</section>
				</div>

				{createdSlug ? (
					<ShareAudienceDialog
						slug={createdSlug}
						open={shareOpen}
						onOpenChange={setShareOpen}
						onContinue={() => {
							setShareOpen(false);
							void navigate({
								to: "/broadcast/$slug",
								params: { slug: createdSlug },
							});
						}}
					/>
				) : null}

				<AlertDialog
					open={sessionToDelete !== null}
					onOpenChange={(open) => {
						if (!open && deletingSessionId === null) {
							setSessionToDelete(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete event</AlertDialogTitle>
							<AlertDialogDescription>
								{sessionToDelete
									? `This deletes "${sessionToDelete.title}" and all captions. You can't undo this.`
									: "You can't undo this."}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={deletingSessionId !== null}>
								Cancel
							</AlertDialogCancel>
							<Button
								variant="destructive"
								disabled={deletingSessionId !== null}
								onClick={() => void confirmDelete()}
							>
								{deletingSessionId ? "Deleting…" : "Delete"}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</main>
		</OperatorChrome>
	);
}
