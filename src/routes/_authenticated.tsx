import {
	createFileRoute,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { PageLoading } from "@/components/loading-states";
import { api } from "@/convex/_generated/api";
import { useClientAuth } from "../lib/auth/client";
import { getOperatorAccessState } from "../lib/auth/operator";

export const Route = createFileRoute("/_authenticated")({
	ssr: false,
	component: AuthenticatedLayout,
	pendingComponent: PageLoading,
});

export function AuthenticatedLayout() {
	const { status } = useClientAuth();
	const isOperator = useQuery(api.users.isOperator);
	const access = getOperatorAccessState({ status }, isOperator);

	if (access === "loading") {
		return <PageLoading />;
	}

	if (access !== "authorized") {
		return <RedirectToLogin />;
	}

	return <Outlet />;
}

function RedirectToLogin() {
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (location.pathname === "/login") return;

		void navigate({
			to: "/login",
			search: { redirect: location.href },
			replace: true,
		});
	}, [location.href, location.pathname, navigate]);

	return <PageLoading />;
}
