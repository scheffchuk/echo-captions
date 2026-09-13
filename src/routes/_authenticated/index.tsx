import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard";
import { PageLoading } from "@/components/loading-states";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
	pendingComponent: PageLoading,
});
