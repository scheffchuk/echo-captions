import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { RegistryProvider } from "@effect/atom-react";
import { createRouter } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import { getConvexUrl } from "./lib/env";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const convex = new ConvexReactClient(getConvexUrl());
	const storage =
		typeof window === "undefined" ? undefined : window.localStorage;

	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		Wrap: ({ children }) => (
			<RegistryProvider>
				<ConvexAuthProvider
					client={convex}
					storage={storage}
					storageNamespace="echo"
				>
					{children}
				</ConvexAuthProvider>
			</RegistryProvider>
		),
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
