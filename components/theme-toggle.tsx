"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({
	className,
	size = "icon-sm",
}: {
	className?: string;
	size?: "sm" | "icon" | "icon-sm";
}) {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const isDark = (theme === "system" ? resolvedTheme : theme) === "dark";
	const buttonSize =
		size === "icon-sm" ? "icon-sm" : size === "icon" ? "icon" : "sm";

	return (
		<Button
			type="button"
			variant="outline"
			size={buttonSize}
			className={cn(className)}
			onClick={() => setTheme(isDark ? "light" : "dark")}
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
		>
			{isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
			{size === "sm" ? (
				<span className="sr-only sm:not-sr-only">
					{isDark ? "Light" : "Dark"}
				</span>
			) : null}
		</Button>
	);
}
