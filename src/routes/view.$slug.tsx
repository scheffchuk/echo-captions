import { createFileRoute } from "@tanstack/react-router";
import { PageLoading } from "@/components/loading-states";
import { ViewerInterface } from "@/components/viewer-interface";

export const Route = createFileRoute("/view/$slug")({
	component: ViewerPage,
	pendingComponent: () => <PageLoading message="Loading session…" />,
});

function ViewerPage() {
	const { slug } = Route.useParams();

	return <ViewerInterface slug={slug} />;
}
