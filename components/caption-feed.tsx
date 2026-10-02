import { ChevronDown } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { CaptionFeedItem } from "@/lib/caption-feed-items";
import { getCommonLanguageName, segmentFontFamily } from "@/lib/languages";
import type { CaptionSegment } from "@/lib/segment-display";
import { getSegmentDisplay } from "@/lib/segment-display";
import { cn } from "@/lib/utils";

function captionFontSize(textScale: number) {
	return `calc(var(--text-caption) * ${textScale})`;
}

function CaptionLine({
	segment,
	languageCode,
	textScale,
	animate,
}: {
	segment: CaptionSegment;
	languageCode: string;
	textScale: number;
	animate?: boolean;
}) {
	const display = getSegmentDisplay(segment, languageCode);

	return (
		<p
			className={cn(
				"font-normal leading-relaxed",
				display.pending
					? "text-muted-foreground caption-pending"
					: "text-caption-foreground",
				animate &&
					"animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none",
			)}
			style={{
				fontSize: captionFontSize(textScale),
				fontFamily: segmentFontFamily(languageCode),
			}}
		>
			{display.text}
		</p>
	);
}

export function CaptionFeed({
	items,
	languageCode,
	partialText,
	showPartial = false,
	textScale = 1,
	loadingMore = false,
	emptyMessage,
	animateEntries = false,
	className,
	renderItemActions,
	onLoadOlder,
	canLoadOlder = false,
}: {
	items: CaptionFeedItem[];
	languageCode: string;
	partialText?: string;
	showPartial?: boolean;
	textScale?: number;
	loadingMore?: boolean;
	emptyMessage?: string;
	animateEntries?: boolean;
	className?: string;
	renderItemActions?: (commitId: string) => ReactNode;
	onLoadOlder?: () => void;
	canLoadOlder?: boolean;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [pinnedToLatest, setPinnedToLatest] = useState(true);
	const pinnedToLatestRef = useRef(pinnedToLatest);
	pinnedToLatestRef.current = pinnedToLatest;

	const previousLayout = useRef<{
		firstId: string | undefined;
		height: number;
		top: number;
	} | null>(null);

	const prependedHistory = useRef(false);
	const readerAnchor = useRef<{ id: string; offset: number } | null>(null);

	const captureReaderAnchor = () => {
		const scroll = scrollRef.current;

		if (!scroll) return;
		const top = scroll.getBoundingClientRect().top;
		const rows = scroll.querySelectorAll<HTMLElement>("[data-caption-id]");

		const row = Array.from(rows).find(
			(row) => row.getBoundingClientRect().bottom > top,
		);

		readerAnchor.current = row?.dataset.captionId
			? {
					id: row.dataset.captionId,
					offset: row.getBoundingClientRect().top - top,
				}
			: null;
	};

	const restoreReaderAnchor = () => {
		const scroll = scrollRef.current;
		const anchor = readerAnchor.current;

		if (!scroll || !anchor) return false;

		const row = Array.from(
			scroll.querySelectorAll<HTMLElement>("[data-caption-id]"),
		).find((row) => row.dataset.captionId === anchor.id);

		if (!row) return false;
		scroll.scrollTop +=
			row.getBoundingClientRect().top -
			scroll.getBoundingClientRect().top -
			anchor.offset;

		return true;
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: layout inputs trigger measurement; anchor functions read only refs
	useLayoutEffect(() => {
		const scroll = scrollRef.current;

		if (!scroll) return;
		const previous = previousLayout.current;
		prependedHistory.current = Boolean(
			previous?.firstId &&
				previous.firstId !== items[0]?.id &&
				items.some((item) => item.id === previous.firstId),
		);

		if (previous && prependedHistory.current) {
			if (!restoreReaderAnchor())
				scroll.scrollTop = previous.top + scroll.scrollHeight - previous.height;
			pinnedToLatestRef.current = false;
			setPinnedToLatest(false);
		} else if (!pinnedToLatestRef.current) {
			restoreReaderAnchor();
		}

		if (!pinnedToLatestRef.current) captureReaderAnchor();

		previousLayout.current = {
			firstId: items[0]?.id,
			height: scroll.scrollHeight,
			top: scroll.scrollTop,
		};
	}, [items, loadingMore, languageCode, textScale]);

	const lastItem = items.at(-1);

	const lastDisplayText = lastItem
		? getSegmentDisplay(lastItem.segment, languageCode).text
		: "";

	const latestKey = [
		items.length,
		lastItem?.id ?? "",
		lastDisplayText,
		showPartial ? (partialText ?? "") : "",
	].join("\0");

	const hasContent =
		items.length > 0 || (showPartial && partialText) || loadingMore;

	const scrollToLatest = () => {
		const node = scrollRef.current;

		if (!node) return;
		node.scrollTop = node.scrollHeight;
	};

	// latestKey fingerprints content growth (partials, new lines, translations)
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll when content key changes
	useEffect(() => {
		if (!pinnedToLatest || prependedHistory.current) return;
		scrollToLatest();
	}, [latestKey, pinnedToLatest]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: observer uses stable refs
	useEffect(() => {
		const content = contentRef.current;
		const scroll = scrollRef.current;

		if (!content || !scroll) return;

		const observer = new ResizeObserver(() => {
			if (!pinnedToLatestRef.current) {
				restoreReaderAnchor();

				return;
			}

			scroll.scrollTop = scroll.scrollHeight;
		});

		observer.observe(content);

		return () => observer.disconnect();
	}, []);

	const handleScroll = () => {
		const node = scrollRef.current;

		if (!node) return;

		if (previousLayout.current) previousLayout.current.top = node.scrollTop;
		captureReaderAnchor();

		const distanceFromBottom =
			node.scrollHeight - node.clientHeight - node.scrollTop;

		setPinnedToLatest(distanceFromBottom < 48);
	};

	const jumpToLatest = () => {
		scrollToLatest();
		setPinnedToLatest(true);
	};

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className={cn(
					"flex min-h-0 flex-1 flex-col overflow-y-auto [overflow-anchor:none]",
					className,
				)}
			>
				<div ref={contentRef} className="flex flex-col gap-4">
					{onLoadOlder && (canLoadOlder || loadingMore) ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="self-center"
							disabled={loadingMore}
							aria-label="Load older captions"
							onClick={() => {
								const scroll = scrollRef.current;

								if (scroll && previousLayout.current) {
									previousLayout.current.height = scroll.scrollHeight;
									previousLayout.current.top = scroll.scrollTop;
								}

								onLoadOlder();
							}}
						>
							{loadingMore ? "Loading older captions…" : "Load older captions"}
						</Button>
					) : null}
					{!hasContent && emptyMessage ? (
						<p className="text-sm text-muted-foreground">{emptyMessage}</p>
					) : null}
					{loadingMore && !onLoadOlder ? (
						<p className="text-label text-muted-foreground text-center">
							Loading more…
						</p>
					) : null}
					{items.map((item, index) => (
						<div key={item.id} data-caption-id={item.id}>
							<CaptionLine
								segment={item.segment}
								languageCode={languageCode}
								textScale={textScale}
								animate={animateEntries && index === items.length - 1}
							/>
							{renderItemActions?.(item.id)}
						</div>
					))}
					{showPartial && partialText ? (
						<p
							className="font-normal text-muted-foreground caption-pending leading-relaxed"
							style={{
								fontSize: captionFontSize(textScale),
								fontFamily: segmentFontFamily(languageCode),
							}}
						>
							{partialText}
						</p>
					) : null}
				</div>
			</div>
			{!pinnedToLatest && hasContent ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="pointer-events-auto size-11 rounded-lg p-0 shadow-md"
						onClick={jumpToLatest}
						aria-label="Jump to latest"
					>
						<ChevronDown className="size-4" aria-hidden="true" />
					</Button>
				</div>
			) : null}
		</div>
	);
}

export function CaptionColumnShell({
	languageCode,
	children,
	className,
	showLabel = true,
	bare = false,
}: {
	languageCode: string;
	children: React.ReactNode;
	className?: string;
	showLabel?: boolean;
	/** Edge-to-edge caption surface without card chrome. */
	bare?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex min-h-0 h-full flex-col overflow-hidden",
				bare ? "bg-background" : "rounded-lg border border-border bg-card",
				className,
			)}
		>
			{showLabel ? (
				<div className="shrink-0 border-b border-border px-4 py-2">
					<p className="text-label font-medium text-foreground/70">
						{getCommonLanguageName(languageCode)}
					</p>
				</div>
			) : null}
			{children}
		</div>
	);
}
