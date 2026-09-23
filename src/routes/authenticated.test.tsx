// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedView } from "./_authenticated";

afterEach(() => {
	cleanup();
});

describe("AuthenticatedLayout", () => {
	it("waits for both auth and the durable Operator check during hydration", () => {
		const navigate = vi.fn();

		const view = render(
			<AuthenticatedView
				access="loading"
				location={{ pathname: "/", href: "https://echo.example/" }}
				navigate={navigate}
			>
				<div>protected outlet</div>
			</AuthenticatedView>,
		);

		expect(screen.getByText("Loading…")).toBeInTheDocument();
		expect(screen.queryByText("protected outlet")).not.toBeInTheDocument();

		view.rerender(
			<AuthenticatedView
				access="authorized"
				location={{ pathname: "/", href: "https://echo.example/" }}
				navigate={navigate}
			>
				<div>protected outlet</div>
			</AuthenticatedView>,
		);

		expect(screen.getByText("protected outlet")).toBeInTheDocument();
	});

	it("redirects a signed-out browser to login with its current return path", async () => {
		const navigate = vi.fn();

		render(
			<AuthenticatedView
				access="unauthenticated"
				location={{
					pathname: "/broadcast/demo",
					href: "https://echo.example/broadcast/demo?mode=live",
				}}
				navigate={navigate}
			>
				<div>protected outlet</div>
			</AuthenticatedView>,
		);

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/login",
				search: { redirect: "https://echo.example/broadcast/demo?mode=live" },
				replace: true,
			}),
		);
	});
});
