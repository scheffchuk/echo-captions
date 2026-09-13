// @vitest-environment jsdom

import { useLocation, useNavigate } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClientAuth } from "../lib/auth/client";
import { AuthenticatedLayout } from "./_authenticated";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));

vi.mock("../lib/auth/client", () => ({ useClientAuth: vi.fn() }));

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router",
	);
	return {
		...actual,
		Outlet: () => <div>protected outlet</div>,
		useLocation: vi.fn(),
		useNavigate: vi.fn(),
	};
});

const mockedUseClientAuth = vi.mocked(useClientAuth);
const mockedUseQuery = vi.mocked(useQuery);
const mockedUseLocation = vi.mocked(useLocation);
const mockedUseNavigate = vi.mocked(useNavigate);

describe("AuthenticatedLayout", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	beforeEach(() => {
		mockedUseClientAuth.mockReturnValue({
			status: "loading",
		} as ReturnType<typeof useClientAuth>);
		mockedUseQuery.mockReturnValue(undefined);
	});

	it("waits for both auth and the durable Operator check during hydration", () => {
		const view = render(<AuthenticatedLayout />);

		expect(screen.getByText("Loading…")).toBeInTheDocument();
		expect(screen.queryByText("protected outlet")).not.toBeInTheDocument();

		mockedUseClientAuth.mockReturnValue({
			status: "authenticated",
		} as ReturnType<typeof useClientAuth>);
		mockedUseQuery.mockReturnValue(true);
		view.rerender(<AuthenticatedLayout />);

		expect(screen.getByText("protected outlet")).toBeInTheDocument();
	});

	it("redirects a signed-out browser to login with its current return path", async () => {
		const navigate = vi.fn();
		mockedUseClientAuth.mockReturnValue({
			status: "unauthenticated",
		} as ReturnType<typeof useClientAuth>);
		mockedUseQuery.mockReturnValue(false);
		mockedUseLocation.mockReturnValue({
			pathname: "/broadcast/demo",
			href: "https://echo.example/broadcast/demo?mode=live",
		} as ReturnType<typeof useLocation>);
		mockedUseNavigate.mockReturnValue(
			navigate as ReturnType<typeof useNavigate>,
		);

		render(<AuthenticatedLayout />);

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/login",
				search: { redirect: "https://echo.example/broadcast/demo?mode=live" },
				replace: true,
			}),
		);
	});
});
