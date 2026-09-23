"use client";

import { Link } from "@tanstack/react-router";
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
import { useState } from "react";
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
import {
	getClipboardErrorMessage,
	getPublicConvexError,
} from "@/lib/expected-errors";
import { getCommonLanguageName } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { getViewerUrl } from "@/lib/viewer-url";
import { useOperatorAuth } from "../src/lib/auth/operator";

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
	session: Doc<"sessions"> & { isLive: boolean },
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

function sortSessions(sessions: Array<Doc<"sessions"> & { isLive: boolean }>) {
	return [...sessions].sort((a, b) => {
		if (a.isLive !== b.isLive) {
			return a.isLive ? -1 : 1;
		}

		const aTime = a.lastActivityAt ?? a._creationTime;
		const bTime = b.lastActivityAt ?? b._creationTime;

		return bTime - aTime;
	});
}

function matchesQuery(
	session: Doc<"sessions"> & { isLive: boolean },
	query: string,
) {
	const q = query.trim().toLowerCase();

	if (!q) return true;

	return session.title.toLowerCase().includes(q);
}

type SessionBusy = {
	copyingSessionId: Id<"sessions"> | null;
	copyingLinkSessionId: Id<"sessions"> | null;
	copiedSessionId: Id<"sessions"> | null;
	copiedLinkSessionId: Id<"sessions"> | null;
	deletingSessionId: Id<"sessions"> | null;
};

function LiveLaunchpad({
	session,
	busy,
	onShare,
	onCopyTranscript,
	onDelete,
}: {
	session: Doc<"sessions"> & { isLive: boolean };
	busy: SessionBusy;
	onShare: () => void;
	onCopyTranscript: () => void;
	onDelete: () => void;
}) {
	const actionsDisabled = busy.deletingSessionId === session._id;

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
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={
							actionsDisabled || busy.copyingLinkSessionId === session._id
						}
						onClick={onShare}
					>
						{busy.copiedLinkSessionId === session._id ? (
							<Check className="size-4" />
						) : (
							<Link2 className="size-4" />
						)}
						Share
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={actionsDisabled || busy.copyingSessionId === session._id}
						onClick={onCopyTranscript}
					>
						{busy.copiedSessionId === session._id ? (
							<Check className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
						Transcript
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="text-muted-foreground hover:text-destructive"
						disabled={actionsDisabled}
						onClick={onDelete}
					>
						<Trash2 className="size-4" />
						Delete
					</Button>
				</div>
			</div>
		</article>
	);
}

function IdleSessionRow({
	session,
	busy,
	onShare,
	onCopyTranscript,
	onDelete,
}: {
	session: Doc<"sessions"> & { isLive: boolean };
	busy: SessionBusy;
	onShare: () => void;
	onCopyTranscript: () => void;
	onDelete: () => void;
}) {
	const actionsDisabled = busy.deletingSessionId === session._id;

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
				<Button
					size="sm"
					variant="ghost"
					disabled={
						actionsDisabled || busy.copyingLinkSessionId === session._id
					}
					onClick={onShare}
				>
					{busy.copiedLinkSessionId === session._id ? (
						<Check className="size-4" />
					) : (
						<Link2 className="size-4" />
					)}
					<span className="sr-only sm:not-sr-only">Share</span>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={actionsDisabled || busy.copyingSessionId === session._id}
					onClick={onCopyTranscript}
				>
					{busy.copiedSessionId === session._id ? (
						<Check className="size-4" />
					) : (
						<Copy className="size-4" />
					)}
					<span className="sr-only sm:not-sr-only">Transcript</span>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="text-muted-foreground hover:text-destructive"
					disabled={actionsDisabled}
					onClick={onDelete}
				>
					<Trash2 className="size-4" />
					<span className="sr-only">Delete</span>
				</Button>
			</div>
		</article>
	);
}

export function Dashboard() {
	const convex = useConvex();
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

	const [copyingSessionId, setCopyingSessionId] =
		useState<Id<"sessions"> | null>(null);

	const [copyingLinkSessionId, setCopyingLinkSessionId] =
		useState<Id<"sessions"> | null>(null);

	const [copiedSessionId, setCopiedSessionId] = useState<Id<"sessions"> | null>(
		null,
	);

	const [copiedLinkSessionId, setCopiedLinkSessionId] =
		useState<Id<"sessions"> | null>(null);

	const [searchQuery, setSearchQuery] = useState("");

	const sortedSessions = sessions ? sortSessions(sessions) : undefined;

	const filteredSessions = sortedSessions?.filter((s) =>
		matchesQuery(s, searchQuery),
	);

	const liveSessions = filteredSessions?.filter((s) => s.isLive) ?? [];
	const idleSessions = filteredSessions?.filter((s) => !s.isLive) ?? [];
	const isLaunchpad = liveSessions.length > 0;
	const primaryLive = liveSessions[0];
	const otherLive = liveSessions.slice(1);

	const busy: SessionBusy = {
		copyingSessionId,
		copyingLinkSessionId,
		copiedSessionId,
		copiedLinkSessionId,
		deletingSessionId,
	};

	const copyTranscript = async (sessionId: Id<"sessions">) => {
		setCopyingSessionId(sessionId);

		try {
			const text = await convex.query(api.segments.transcriptText, {
				sessionId,
			});

			await navigator.clipboard.writeText(text);
			setCopiedSessionId(sessionId);
			toast.success("Copied");
			setTimeout(() => setCopiedSessionId(null), 2000);
		} catch (err) {
			if (err instanceof DOMException) {
				toast.error(
					getClipboardErrorMessage(err, "Couldn't copy transcript. Try again."),
				);
			} else {
				toast.error(
					getPublicConvexError(err, "Couldn't copy transcript. Try again.")
						.message,
				);
			}
		} finally {
			setCopyingSessionId(null);
		}
	};

	const copyViewerLink = async (slug: string, sessionId: Id<"sessions">) => {
		setCopyingLinkSessionId(sessionId);

		try {
			await navigator.clipboard.writeText(getViewerUrl(slug));
			setCopiedLinkSessionId(sessionId);
			toast.success("Link copied");
			setTimeout(() => setCopiedLinkSessionId(null), 2000);
		} catch (err) {
			toast.error(
				getClipboardErrorMessage(err, "Couldn't copy link. Try again."),
			);
		} finally {
			setCopyingLinkSessionId(null);
		}
	};

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

	const sessionHandlers = (session: Doc<"sessions"> & { isLive: boolean }) => ({
		onShare: () => void copyViewerLink(session.slug, session._id),
		onCopyTranscript: () => void copyTranscript(session._id),
		onDelete: () =>
			setSessionToDelete({
				id: session._id,
				title: session.title,
			}),
	});

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
								<CreateEventForm />
							</DashboardEmptyState>
						) : (
							<>
								{isLaunchpad && primaryLive ? (
									<div className="space-y-4">
										<div className="flex items-center justify-end">
											<CreateEventForm triggerVariant="outline" />
										</div>
										<LiveLaunchpad
											session={primaryLive}
											busy={busy}
											{...sessionHandlers(primaryLive)}
										/>
										{otherLive.map((session) => (
											<LiveLaunchpad
												key={session._id}
												session={session}
												busy={busy}
												{...sessionHandlers(session)}
											/>
										))}
									</div>
								) : (
									<div className="flex items-center justify-between gap-4">
										<h2 className="text-title">Events</h2>
										<CreateEventForm />
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
														busy={busy}
														{...sessionHandlers(session)}
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
