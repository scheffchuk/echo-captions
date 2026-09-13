// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperatorAuth } from "../lib/auth/operator";
import { LoginPage } from "./login";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	search: { redirect: "/broadcast/demo?mode=live" },
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: Record<string, unknown>) => ({
		...options,
		useSearch: () => mocks.search,
	}),
	useNavigate: () => mocks.navigate,
}));

vi.mock("../lib/auth/operator", () => ({
	getOperatorAuthErrorMessage: () => "Sign-in failed. Try again.",
	useOperatorAuth: vi.fn(),
}));

const mockedUseOperatorAuth = vi.mocked(useOperatorAuth);

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.search.redirect = "/broadcast/demo?mode=live";
	mockedUseOperatorAuth.mockReturnValue({
		status: "authenticated",
		isOperator: true,
		accountState: { hasAccount: true, signupAllowed: false },
		defaultFlow: "signIn",
		canSignUp: false,
		signInWithPassword: vi.fn(),
		changePassword: vi.fn(),
		signOut: vi.fn(),
	});
});

describe("LoginPage", () => {
	it("navigates once to the validated destination after authentication", async () => {
		render(
			<StrictMode>
				<LoginPage />
			</StrictMode>,
		);

		await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
		expect(mocks.navigate).toHaveBeenCalledWith({
			href: "/broadcast/demo?mode=live",
		});
	});

	it("keeps the login form hidden while auth state is bootstrapping", () => {
		const view = render(<LoginPage />);

		expect(screen.getByText("Loading…")).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument();

		mockedUseOperatorAuth.mockReturnValue({
			status: "unauthenticated",
			isOperator: false,
			accountState: { hasAccount: true, signupAllowed: false },
			defaultFlow: "signIn",
			canSignUp: false,
			signInWithPassword: vi.fn(),
			changePassword: vi.fn(),
			signOut: vi.fn(),
		});
		view.rerender(<LoginPage />);

		expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
	});

	it("does not navigate to an external return target", () => {
		mocks.search.redirect = "https://evil.example/steal";
		mockedUseOperatorAuth.mockReturnValue({
			status: "unauthenticated",
			isOperator: false,
			accountState: { hasAccount: true, signupAllowed: false },
			defaultFlow: "signIn",
			canSignUp: false,
			signInWithPassword: vi.fn(),
			changePassword: vi.fn(),
			signOut: vi.fn(),
		});

		render(<LoginPage />);

		expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});
});
