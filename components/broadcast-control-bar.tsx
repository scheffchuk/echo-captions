import { Loader2, Square } from "lucide-react";
import { LanguagePairPicker } from "@/components/language-pair-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MicSelector } from "@/components/ui/mic-selector";
import { Separator } from "@/components/ui/separator";
import type {
	BroadcastLifecycleStatus,
	BroadcastVoiceState,
} from "@/hooks/use-broadcast-recording";
import type { LanguagePair } from "@/lib/languages";
import { cn } from "@/lib/utils";

function RecordIcon() {
	return (
		<span
			className="relative flex size-4 items-center justify-center"
			aria-hidden
		>
			<span className="absolute inset-0 rounded-full border-2 border-primary-foreground/80" />
			<span className="size-2 rounded-full bg-primary-foreground" />
		</span>
	);
}

export function BroadcastControlBar({
	deviceId,
	onDeviceChange,
	voiceState,
	broadcastStatus,
	onRecordPress,
	languagePair,
	audienceLanguages,
	onLanguageChange,
	onMicError,
	className,
}: {
	deviceId: string;
	onDeviceChange: (deviceId: string) => void;
	voiceState: BroadcastVoiceState;
	broadcastStatus?: BroadcastLifecycleStatus;
	onRecordPress: () => void;
	languagePair: LanguagePair;
	audienceLanguages: string[];
	onLanguageChange: (pair: LanguagePair) => void;
	onMicError?: (message: string) => void;
	className?: string;
}) {
	const isVoiceActive = voiceState === "recording";
	const isConnecting = voiceState === "connecting";
	const isLost = broadcastStatus === "lost";
	const isStopping = broadcastStatus === "stopping";
	const micSelectorDisabled = isVoiceActive || isConnecting;
	const recordDisabled = !deviceId || isConnecting || isStopping;

	const recordLabel = isLost
		? "Resume"
		: isStopping
			? "Finishing…"
			: isConnecting
				? "Connecting…"
				: isVoiceActive
					? "Stop"
					: "Go live";

	return (
		<div className={cn("flex justify-center", className)}>
			<Card className="m-0 w-fit max-w-full gap-0 rounded-lg bg-card py-0 shadow-none ring-1 ring-border/60">
				<div className="flex w-fit min-w-0 max-w-full flex-wrap items-center justify-center gap-2 p-2">
					<div
						className={cn(
							"flex h-8 shrink-0 items-center rounded-md px-2 py-2",
							"bg-muted text-muted-foreground",
						)}
					>
						{audienceLanguages.length > 0 ? (
							<LanguagePairPicker
								languages={audienceLanguages}
								pair={languagePair}
								onChange={onLanguageChange}
								size="sm"
								compact
								className="h-7 w-auto border-0 bg-transparent px-2 shadow-none hover:bg-transparent"
							/>
						) : (
							<span className="px-2 text-xs font-medium text-muted-foreground">
								No display languages
							</span>
						)}
					</div>
					<div className="flex min-w-0 shrink-0 items-center gap-2">
						<MicSelector
							value={deviceId}
							onValueChange={onDeviceChange}
							disabled={micSelectorDisabled}
							onError={onMicError}
						/>
						<Separator orientation="vertical" className="mx-1 h-8" />
						<Button
							variant={isVoiceActive && !isLost ? "destructive" : "default"}
							size="default"
							className="h-9 min-w-24 gap-2 px-3"
							onClick={onRecordPress}
							disabled={recordDisabled}
							aria-label={`${recordLabel} (Space)`}
							aria-keyshortcuts="Space"
							title="Space"
						>
							{isConnecting ? (
								<Loader2 className="size-4 animate-spin" />
							) : isVoiceActive ? (
								<Square className="size-3.5 fill-current" />
							) : (
								<RecordIcon />
							)}
							{recordLabel}
						</Button>
					</div>
				</div>
			</Card>
		</div>
	);
}
