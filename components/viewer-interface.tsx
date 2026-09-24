import { useQuery } from "convex/react";
import { useState } from "react";
import { CaptionColumnShell, CaptionFeed } from "@/components/caption-feed";
import { LanguagePairPicker } from "@/components/language-pair-picker";
import { LiveBadge, PausedBadge } from "@/components/live-badge";
import {
	CaptionFeedSkeleton,
	PageLoading,
	SessionNotFound,
} from "@/components/loading-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { api } from "@/convex/_generated/api";
import { useSessionCaptionFeed } from "@/hooks/use-session-caption-feed";
import { getCommonLanguageName, type LanguagePair } from "@/lib/languages";
import {
	getStoredTextSize,
	resolveViewerLanguagePair,
	setStoredLanguagePair,
	setStoredTextSize,
} from "@/lib/viewer-preferences";

export function ViewerInterface({ slug }: { slug: string }) {
	const session = useQuery(api.sessions.getBySlug, { slug });
	const audienceLanguages: string[] = session?.audienceLanguages ?? [];
	const audienceKey = audienceLanguages.join(",");

	const [userLanguagePair, setUserLanguagePair] = useState<LanguagePair | null>(
		null,
	);

	const [textScale, setTextScale] = useState(() => getStoredTextSize());

	const defaultLanguagePair = audienceKey
		? resolveViewerLanguagePair(slug, audienceKey.split(","))
		: null;

	const languagePair = userLanguagePair ?? defaultLanguagePair;

	const { feedItems, status } = useSessionCaptionFeed(session?._id);

	const isDual =
		languagePair !== null &&
		languagePair.length === 2 &&
		audienceLanguages.length >= 2;

	const [lang1, lang2] = isDual
		? languagePair
		: [
				languagePair?.[0] ?? audienceLanguages[0],
				languagePair?.[0] ?? audienceLanguages[0],
			];

	const changeLanguagePair = (next: LanguagePair) => {
		setUserLanguagePair(next);
		setStoredLanguagePair(slug, next);
	};

	const changeTextScale = (delta: number) => {
		setTextScale((current) => {
			const next = Math.min(1.4, Math.max(0.8, current + delta));
			setStoredTextSize(next);

			return next;
		});
	};

	const viewerState = !session
		? "loading"
		: session.isLive
			? "live"
			: feedItems.length === 0
				? "waiting"
				: "paused";

	if (session === undefined) {
		return <PageLoading message="Loading session…" />;
	}

	if (session === null) {
		return <SessionNotFound variant="audience" />;
	}

	const emptyMessage =
		viewerState === "live" ? "Listening…" : "No captions yet";

	const isLoadingFirstPage = status === "LoadingFirstPage";

	const captionColumn = (code: string, options?: { bare?: boolean }) => (
		<CaptionColumnShell
			key={code}
			className="min-h-0 flex-1"
			languageCode={code}
			showLabel={isDual}
			bare={options?.bare ?? !isDual}
		>
			{isLoadingFirstPage ? (
				<CaptionFeedSkeleton className="p-4 sm:p-6" />
			) : (
				<CaptionFeed
					className="p-4 sm:p-6"
					items={feedItems}
					languageCode={code}
					textScale={textScale}
					loadingMore={status === "LoadingMore"}
					emptyMessage={emptyMessage}
					animateEntries
				/>
			)}
		</CaptionColumnShell>
	);

	return (
		<main className="viewer-light flex h-dvh flex-col bg-background text-foreground">
			<header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-background px-3 py-2.5 sm:px-4">
				<div className="flex min-w-0 items-center gap-2">
					{session.title ? (
						<h1 className="min-w-0 truncate text-sm font-medium sm:text-base">
							{session.title}
						</h1>
					) : null}
					{viewerState === "live" ? <LiveBadge /> : null}
					{viewerState === "paused" ? <PausedBadge /> : null}
				</div>
				<div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
					{languagePair ? (
						<LanguagePairPicker
							languages={audienceLanguages}
							pair={languagePair}
							onChange={changeLanguagePair}
							size="default"
							mode="audience"
							className="min-h-11 min-w-0"
						/>
					) : null}
					<ButtonGroup aria-label="Text size">
						<Button
							size="default"
							variant="outline"
							className="min-h-11 px-3"
							onClick={() => changeTextScale(-0.1)}
							aria-label="Decrease text size"
						>
							A-
						</Button>
						<Button
							size="default"
							variant="outline"
							className="min-h-11 px-3"
							onClick={() => changeTextScale(0.1)}
							aria-label="Increase text size"
						>
							A+
						</Button>
					</ButtonGroup>
				</div>
			</header>

			{viewerState === "waiting" ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-8">
					<div className="w-full max-w-lg space-y-4">
						<p className="text-title text-balance">Not started yet</p>
						{audienceLanguages.length > 0 ? (
							<div className="space-y-2">
								<p className="text-sm text-muted-foreground">
									You can read captions in
								</p>
								<div className="flex flex-wrap gap-2">
									{audienceLanguages.map((code) => (
										<Badge key={code} variant="secondary">
											{getCommonLanguageName(code)}
										</Badge>
									))}
								</div>
							</div>
						) : null}
						<p className="text-sm text-muted-foreground text-pretty">
							You&apos;ll see captions when the host goes live.
						</p>
					</div>
				</div>
			) : isDual ? (
				<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 md:grid-cols-2">
					{captionColumn(lang1)}
					{captionColumn(lang2)}
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					{captionColumn(lang1, { bare: true })}
				</div>
			)}
		</main>
	);
}
