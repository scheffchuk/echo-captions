import type { ComponentProps } from "react";
import { CaptionFeed } from "@/components/caption-feed";
import { Button } from "@/components/ui/button";
import type { useSessionOperatorCommits } from "@/hooks/use-session-operator-commits";

export function OperatorCaptionFeed({
	operator,
	...props
}: Omit<ComponentProps<typeof CaptionFeed>, "renderItemActions"> & {
	operator: ReturnType<typeof useSessionOperatorCommits>;
}) {
	const commitsById = new Map(
		operator.commits.map((commit) => [commit.commitId, commit]),
	);

	return (
		<CaptionFeed
			{...props}
			onLoadOlder={operator.loadOlder}
			canLoadOlder={operator.canLoadOlder}
			loadingMore={operator.loadingOlder}
			renderItemActions={(commitId) => {
				const commit = commitsById.get(commitId);

				if (!commit) return null;
				const retrying = operator.isRetrying(commitId);

				if (!retrying && commit.status !== "failed") return null;

				return (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="mt-1 text-muted-foreground"
						disabled={retrying}
						aria-label="Retry caption"
						onClick={() => {
							void operator.retry(commitId);
						}}
					>
						{retrying ? "Retrying…" : "Retry"}
					</Button>
				);
			}}
		/>
	);
}
