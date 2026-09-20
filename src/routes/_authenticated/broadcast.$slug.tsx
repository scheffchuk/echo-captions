import { createFileRoute } from "@tanstack/react-router";
import { BroadcastInterface } from "@/components/broadcast-interface";
import { PageLoading } from "@/components/loading-states";

export const Route = createFileRoute("/_authenticated/broadcast/$slug")({
	component: BroadcastPage,
	pendingComponent: () => <PageLoading message="Loading session…" />,
});

function BroadcastPage() {
	const { slug } = Route.useParams();
	return <BroadcastInterface key={slug} slug={slug} />;
}
