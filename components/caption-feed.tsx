"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [pinnedToLatest, setPinnedToLatest] = useState(true);
	const pinnedToLatestRef = useRef(pinnedToLatest);
	pinnedToLatestRef.current = pinnedToLatest;

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
		if (!pinnedToLatest) return;
		scrollToLatest();
	}, [latestKey, pinnedToLatest]);

	useEffect(() => {
		const content = contentRef.current;
		const scroll = scrollRef.current;
		if (!content || !scroll) return;

		const observer = new ResizeObserver(() => {
			if (!pinnedToLatestRef.current) return;
			scroll.scrollTop = scroll.scrollHeight;
		});
		observer.observe(content);
		return () => observer.disconnect();
	}, []);

	const handleScroll = () => {
		const node = scrollRef.current;
		if (!node) return;
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
					"flex min-h-0 flex-1 flex-col overflow-y-auto",
					className,
				)}
			>
				<div ref={contentRef} className="flex flex-col gap-4">
					{!hasContent && emptyMessage ? (
						<p className="text-sm text-muted-foreground">{emptyMessage}</p>
					) : null}
					{loadingMore ? (
						<p className="text-label text-muted-foreground text-center">
							Loading more…
						</p>
					) : null}
					{items.map((item, index) => (
						<CaptionLine
							key={item.id}
							segment={item.segment}
							languageCode={languageCode}
							textScale={textScale}
							animate={animateEntries && index === items.length - 1}
						/>
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
