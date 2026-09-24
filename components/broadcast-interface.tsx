import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BroadcastControlBar } from "@/components/broadcast-control-bar";
import { BroadcastLiveExtras } from "@/components/broadcast-live-extras";
import {
	BroadcastSessionTools,
	BroadcastSetupHint,
} from "@/components/broadcast-session-tools";
import { CaptionColumnShell, CaptionFeed } from "@/components/caption-feed";
import { EditableHeader } from "@/components/editable-header";
import { ConnectingBadge, LiveBadge } from "@/components/live-badge";
import { PageLoading, SessionNotFound } from "@/components/loading-states";
import { OperatorChrome } from "@/components/operator-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { formatRejectedCaptures } from "@/hooks/broadcast-capture";
import {
	ignorePresentedBroadcastError,
	toBroadcastCommandError,
} from "@/hooks/broadcast-model";
import { useBroadcastRecording } from "@/hooks/use-broadcast-recording";
import { useSessionOperatorCommits } from "@/hooks/use-session-operator-commits";
import {
	getStoredMicDevice,
	setStoredMicDevice,
} from "@/lib/broadcast-preferences";
import type { LanguagePair } from "@/lib/languages";
import {
	mergeOperatorCommitProjections,
	operatorCommitsToFeedItems,
} from "@/lib/operator-commit-feed";
import { cn } from "@/lib/utils";
import {
	resolveLanguagePair,
	setStoredLanguagePair,
} from "@/lib/viewer-preferences";

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;

	if (target.isContentEditable) return true;

	return Boolean(
		target.closest("input, textarea, select, [contenteditable=true]"),
	);
}

export function BroadcastInterface({ slug }: { slug: string }) {
	const session = useQuery(api.sessions.getMineBySlug, { slug });
	const updateTitle = useMutation(api.sessions.updateTitle);
	const updateDescription = useMutation(api.sessions.updateDescription);
	const abandonBroadcast = useMutation(api.broadcasts.abandon);

	const [deviceId, setDeviceId] = useState(
		() => getStoredMicDevice(slug) ?? "",
	);

	const [localTitle, setLocalTitle] = useState<string | null>(null);
	const [localDescription, setLocalDescription] = useState<string | null>(null);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
	const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false);
	const [abandoningBroadcast, setAbandoningBroadcast] = useState(false);

	const audienceLanguages = session?.audienceLanguages ?? [];
	const defaultSourceLanguage = session?.spokenLanguages[0] ?? "en";
	const broadcastStatus = session?.activeBroadcast?.status;

	const lostBroadcastId =
		broadcastStatus === "lost" ? session?.activeBroadcast?._id : null;

	const hasLostBroadcast =
		lostBroadcastId !== null && lostBroadcastId !== undefined;

	const [userLanguagePair, setUserLanguagePair] = useState<LanguagePair | null>(
		null,
	);

	const defaultLanguagePair =
		audienceLanguages.length > 0
			? resolveLanguagePair(slug, audienceLanguages)
			: null;

	const languagePair = userLanguagePair ?? defaultLanguagePair;

	const operatorCommits = useSessionOperatorCommits(session?._id);

	const isDual =
		languagePair !== null &&
		languagePair.length === 2 &&
		audienceLanguages.length >= 2;

	const [lang1, lang2] = isDual
		? languagePair
		: [
				languagePair?.[0] ?? audienceLanguages[0] ?? defaultSourceLanguage,
				languagePair?.[0] ?? audienceLanguages[0] ?? defaultSourceLanguage,
			];

	const showPartialInColumn = (code: string) =>
		!isDual || code === defaultSourceLanguage;

	const {
		isConnected,
		voiceState,
		partialText,
		toggleRecording,
		abandonRecording,
		optimisticCaptures,
		rejectedCaptures,
		clearRejectedCaptures,
	} = useBroadcastRecording({
		sessionId: session?._id,
		deviceId,
		broadcastStatus,
		recoverableBroadcastId: lostBroadcastId,
		onError: toast.error,
	});

	const feedItems = operatorCommitsToFeedItems(
		mergeOperatorCommitProjections(operatorCommits, optimisticCaptures),
	);

	const requestToggleRecording = () => {
		if (voiceState === "connecting") return;

		if (hasLostBroadcast) {
			if (!deviceId) {
				toast.error("Select a microphone before resuming.");

				return;
			}

			void toggleRecording().catch(ignorePresentedBroadcastError);

			return;
		}

		if (isConnected) {
			setStopConfirmOpen(true);

			return;
		}

		if (!deviceId) {
			toast.error("Select a microphone before going live.");

			return;
		}

		void toggleRecording().catch(ignorePresentedBroadcastError);
	};

	const confirmStop = () => {
		setStopConfirmOpen(false);
		void toggleRecording().catch(ignorePresentedBroadcastError);
	};

	const confirmAbandon = async () => {
		if (!lostBroadcastId) return;
		setAbandoningBroadcast(true);

		try {
			await abandonBroadcast({ broadcastId: lostBroadcastId });
			abandonRecording();
			setAbandonConfirmOpen(false);
			toast.success("Lost broadcast abandoned. Caption order is sealed.");
		} catch (error) {
			toast.error(toBroadcastCommandError(error).message);
		} finally {
			setAbandoningBroadcast(false);
		}
	};

	const exportRejectedCaptures = () => {
		const content = formatRejectedCaptures(rejectedCaptures);

		const url = URL.createObjectURL(
			new Blob([content], { type: "text/plain;charset=utf-8" }),
		);

		const link = document.createElement("a");
		link.href = url;
		link.download = `echo-rejected-captures-${new Date().toISOString().slice(0, 10)}.txt`;
		link.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	const isConnectedRef = useRef(isConnected);
	isConnectedRef.current = isConnected;
	const stopConfirmOpenRef = useRef(stopConfirmOpen);
	stopConfirmOpenRef.current = stopConfirmOpen;
	const toolsOpenRef = useRef(toolsOpen);
	toolsOpenRef.current = toolsOpen;
	const requestToggleRecordingRef = useRef(requestToggleRecording);
	requestToggleRecordingRef.current = requestToggleRecording;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code !== "Space" && event.key !== " ") return;

			if (event.repeat) return;

			if (isEditableTarget(event.target)) return;

			if (
				event.target instanceof HTMLElement &&
				event.target.closest('[role="dialog"], [role="alertdialog"]')
			) {
				return;
			}

			if (stopConfirmOpenRef.current || toolsOpenRef.current) return;
			event.preventDefault();
			requestToggleRecordingRef.current();
		};

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!isConnectedRef.current) return;
			event.preventDefault();
			event.returnValue = "";
		};

		window.addEventListener("beforeunload", onBeforeUnload);

		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, []);

	const handleDeviceChange = (nextDeviceId: string) => {
		setDeviceId(nextDeviceId);
		setStoredMicDevice(slug, nextDeviceId);
	};

	const title = localTitle ?? session?.title ?? "Untitled";
	const description = localDescription ?? session?.description;

	const showSetupHint =
		!hasLostBroadcast &&
		broadcastStatus !== "stopping" &&
		!isConnected &&
		feedItems.length === 0 &&
		!partialText;

	const rejectedCapturesNotice =
		rejectedCaptures.length > 0 ? (
			<div className="flex shrink-0 flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<p className="font-medium text-foreground">
						{rejectedCaptures.length} caption
						{rejectedCaptures.length === 1 ? "" : "s"} not accepted
					</p>
					<p className="text-muted-foreground text-pretty">
						These captures are private to this browser tab. Export them before
						discarding if you need a record.
					</p>
				</div>
				<div className="flex shrink-0 gap-2">
					<Button size="sm" variant="outline" onClick={exportRejectedCaptures}>
						Export
					</Button>
					<Button size="sm" variant="ghost" onClick={clearRejectedCaptures}>
						Discard
					</Button>
				</div>
			</div>
		) : null;

	const stoppingBroadcastNotice =
		broadcastStatus === "stopping" ? (
			<div className="flex shrink-0 items-center rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
				Finishing captions from the previous broadcast…
			</div>
		) : null;

	const changeLanguagePair = (next: LanguagePair) => {
		setUserLanguagePair(next);
		setStoredLanguagePair(slug, next);
	};

	const persistTitle = async (nextTitle: string) => {
		setLocalTitle(nextTitle);

		if (session) {
			await updateTitle({ sessionId: session._id, title: nextTitle });
		}
	};

	const persistDescription = async (nextDescription: string) => {
		setLocalDescription(nextDescription);

		if (session) {
			await updateDescription({
				sessionId: session._id,
				description: nextDescription,
			});
		}
	};

	const openSessionTools = () => setToolsOpen(true);

	const sessionToolsProps = session
		? {
				slug,
				sessionId: session._id,
				initialMappings: session.translationMappings,
				initialRevisionId: session.translationMappingRevisionId,
				audienceCodes: audienceLanguages,
				sheetOpen: toolsOpen,
				onSheetOpenChange: setToolsOpen,
			}
		: null;

	const captionEmptyMessage = isConnected ? "Listening…" : "No captions yet";

	const captionArea = showSetupHint ? (
		<BroadcastSetupHint onOpenSessionTools={openSessionTools} />
	) : isDual ? (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:flex-row">
			<CaptionColumnShell className="min-h-0 flex-1" languageCode={lang1}>
				<CaptionFeed
					className="p-4"
					items={feedItems}
					languageCode={lang1}
					partialText={partialText}
					showPartial={showPartialInColumn(lang1)}
					emptyMessage={captionEmptyMessage}
					animateEntries
				/>
			</CaptionColumnShell>
			<CaptionColumnShell className="min-h-0 flex-1" languageCode={lang2}>
				<CaptionFeed
					className="p-4"
					items={feedItems}
					languageCode={lang2}
					partialText={partialText}
					showPartial={showPartialInColumn(lang2)}
					emptyMessage={captionEmptyMessage}
					animateEntries
				/>
			</CaptionColumnShell>
		</div>
	) : (
		<CaptionColumnShell className="min-h-0 flex-1" languageCode={lang1}>
			<CaptionFeed
				className="p-4"
				items={feedItems}
				languageCode={lang1}
				partialText={partialText}
				showPartial
				emptyMessage={captionEmptyMessage}
				animateEntries
			/>
		</CaptionColumnShell>
	);

	const lostBroadcastNotice = hasLostBroadcast ? (
		<div className="flex shrink-0 flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-1">
				<p className="font-medium text-foreground">Broadcast connection lost</p>
				<p className="text-muted-foreground text-pretty">
					Resume to keep this Broadcast and its caption order, or abandon the
					unknown tail if no capture can be recovered.
				</p>
			</div>
			<div className="flex shrink-0 gap-2">
				<Button
					size="sm"
					onClick={requestToggleRecording}
					disabled={voiceState === "connecting" || !deviceId}
				>
					Resume
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setAbandonConfirmOpen(true)}
					disabled={abandoningBroadcast}
				>
					Abandon tail
				</Button>
			</div>
		</div>
	) : null;

	if (session === undefined) {
		return <PageLoading message="Loading session…" />;
	}

	if (session === null) {
		return <SessionNotFound />;
	}

	return (
		<OperatorChrome>
			<main className="flex h-dvh flex-col p-4">
				<Toaster />
				<div className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col">
					<div
						className={cn(
							"mb-4 shrink-0 space-y-4",
							isConnected && "space-y-2",
						)}
					>
						<div className="flex flex-wrap items-center justify-between gap-4">
							<Link
								to="/"
								className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
							>
								<ArrowLeft className="mr-2 size-4" />
								Dashboard
							</Link>
							<div className="flex flex-wrap items-center justify-end gap-2">
								{!isConnected ? <ThemeToggle /> : null}
								{voiceState === "connecting" && <ConnectingBadge />}
								{session.isLive && <LiveBadge />}
								{hasLostBroadcast ? (
									<span className="rounded-full border border-destructive/30 px-2 py-1 text-xs font-medium text-destructive">
										Broadcast lost
									</span>
								) : null}
								{isConnected && sessionToolsProps ? (
									<BroadcastLiveExtras
										slug={slug}
										sessionId={sessionToolsProps.sessionId}
										initialMappings={sessionToolsProps.initialMappings}
										initialRevisionId={sessionToolsProps.initialRevisionId}
										audienceCodes={sessionToolsProps.audienceCodes}
									/>
								) : null}
								{!isConnected && sessionToolsProps ? (
									<div className="lg:hidden">
										<BroadcastSessionTools {...sessionToolsProps} collapsed />
									</div>
								) : null}
							</div>
						</div>
						<EditableHeader
							title={title}
							description={description}
							onTitleChange={persistTitle}
							onDescriptionChange={persistDescription}
							disabled={isConnected}
							compact
						/>
					</div>

					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						<div
							className={cn(
								"flex min-h-0 flex-1 gap-8 overflow-hidden",
								isConnected ? "flex-col" : "flex-col lg:flex-row",
							)}
						>
							<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
								{lostBroadcastNotice}
								{rejectedCapturesNotice}
								{stoppingBroadcastNotice}
								{captionArea}
							</div>

							{!isConnected && sessionToolsProps ? (
								<BroadcastSessionTools
									{...sessionToolsProps}
									collapsed={false}
									className="hidden lg:flex"
								/>
							) : null}
						</div>
					</div>

					<BroadcastControlBar
						className="mt-auto shrink-0 pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
						deviceId={deviceId}
						onDeviceChange={handleDeviceChange}
						voiceState={voiceState}
						broadcastStatus={broadcastStatus}
						onRecordPress={requestToggleRecording}
						languagePair={
							languagePair ?? [audienceLanguages[0] ?? defaultSourceLanguage]
						}
						audienceLanguages={audienceLanguages}
						onLanguageChange={changeLanguagePair}
						onMicError={toast.error}
					/>
				</div>

				<AlertDialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Stop broadcasting?</AlertDialogTitle>
							<AlertDialogDescription>
								Captions stop for everyone in the room. You can go live again
								from this page.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Keep going</AlertDialogCancel>
							<AlertDialogAction variant="destructive" onClick={confirmStop}>
								Stop
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				<AlertDialog
					open={abandonConfirmOpen}
					onOpenChange={(open) => {
						if (!abandoningBroadcast) setAbandonConfirmOpen(open);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Abandon lost broadcast?</AlertDialogTitle>
							<AlertDialogDescription>
								This seals the broadcast at the highest caption ordinal the
								server received. Any capture after that point cannot be
								recovered.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={abandoningBroadcast}>
								Keep broadcast
							</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={(event) => {
									event.preventDefault();
									void confirmAbandon();
								}}
								disabled={abandoningBroadcast}
							>
								{abandoningBroadcast ? "Abandoning…" : "Abandon tail"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</main>
		</OperatorChrome>
	);
}
