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
import {
	getOperatorAccessState,
	type OperatorAccessState,
} from "../lib/auth/operator";

export const Route = createFileRoute("/_authenticated")({
	ssr: false,
	component: AuthenticatedLayout,
	pendingComponent: PageLoading,
});

export function AuthenticatedLayout() {
	const { status } = useClientAuth();
	const isOperator = useQuery(api.users.isOperator);
	const access = getOperatorAccessState({ status }, isOperator);
	const navigate = useNavigate();
	const location = useLocation();

	return (
		<AuthenticatedView
			access={access}
			location={{ pathname: location.pathname, href: location.href }}
			navigate={(options) => {
				void navigate(options);
			}}
		>
			<Outlet />
		</AuthenticatedView>
	);
}

export function AuthenticatedView({
	access,
	location,
	navigate,
	children,
}: {
	access: OperatorAccessState;
	location: { pathname: string; href: string };
	navigate: (options: {
		to: "/login";
		search: { redirect: string };
		replace: true;
	}) => void;
	children: React.ReactNode;
}) {
	if (access === "loading") {
		return <PageLoading />;
	}

	if (access !== "authorized") {
		return <RedirectToLogin location={location} navigate={navigate} />;
	}

	return children;
}

function RedirectToLogin({
	location,
	navigate,
}: {
	location: { pathname: string; href: string };
	navigate: (options: {
		to: "/login";
		search: { redirect: string };
		replace: true;
	}) => void;
}) {
	useEffect(() => {
		if (location.pathname === "/login") return;

		navigate({
			to: "/login",
			search: { redirect: location.href },
			replace: true,
		});
	}, [location.href, location.pathname, navigate]);

	return <PageLoading />;
}
