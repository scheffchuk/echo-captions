import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../../app/globals.css?url";
import fontCss from "../fonts.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ title: "Echo" },
			{
				name: "description",
				content:
					"Live captions for talks. You speak; the audience reads English, Chinese, or Japanese.",
			},
			{
				name: "theme-color",
				content: "#fafafa",
				media: "(prefers-color-scheme: light)",
			},
			{
				name: "theme-color",
				content: "#171717",
				media: "(prefers-color-scheme: dark)",
			},
			{ name: "apple-mobile-web-app-title", content: "Echo" },
			{ name: "generator", content: "Echo" },
		],
		links: [
			{ rel: "stylesheet", href: fontCss },
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: "/manifest.json" },
		],
	}),
	component: RootComponent,
	notFoundComponent: NotFound,
	errorComponent: DefaultError,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="font-sans antialiased bg-background text-foreground">
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
					<TooltipProvider>{children}</TooltipProvider>
				</ThemeProvider>
				<Analytics />
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
			<p className="text-title">Page not found</p>
			<p className="max-w-sm text-sm text-muted-foreground">
				That link doesn’t exist. Check it and try again.
			</p>
		</main>
	);
}

function DefaultError({ error, reset }: { error: Error; reset: () => void }) {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
			<p className="text-title">Something went wrong</p>
			<p className="max-w-sm text-sm text-muted-foreground">
				{error.message || "An unexpected error occurred."}
			</p>
			<Button onClick={reset}>Try again</Button>
		</main>
	);
}
