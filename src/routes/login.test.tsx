// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginView } from "./login";

function authState(
	overrides: Partial<Parameters<typeof LoginView>[0]["auth"]> = {},
) {
	return {
		status: "authenticated" as const,
		isOperator: true,
		accountState: { hasAccount: true, signupAllowed: false },
		defaultFlow: "signIn" as const,
		canSignUp: false,
		signInWithPassword: vi.fn(),
		changePassword: vi.fn(),
		signOut: vi.fn(),
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("LoginPage", () => {
	it("navigates once to the validated destination after authentication", async () => {
		const navigate = vi.fn();

		render(
			<StrictMode>
				<LoginView
					redirect="/broadcast/demo?mode=live"
					navigate={navigate}
					auth={authState()}
				/>
			</StrictMode>,
		);

		await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
		expect(navigate).toHaveBeenCalledWith({
			href: "/broadcast/demo?mode=live",
		});
	});

	it("keeps the login form hidden while auth state is bootstrapping", () => {
		const navigate = vi.fn();

		const view = render(
			<LoginView
				redirect="/broadcast/demo?mode=live"
				navigate={navigate}
				auth={authState({
					status: "loading",
					isOperator: undefined,
					defaultFlow: "loading",
				})}
			/>,
		);

		expect(screen.getByText("Loading…")).toBeInTheDocument();
		expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument();

		view.rerender(
			<LoginView
				redirect="/broadcast/demo?mode=live"
				navigate={navigate}
				auth={authState({
					status: "unauthenticated",
					isOperator: false,
				})}
			/>,
		);

		expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
	});

	it("does not navigate to an external return target", () => {
		const navigate = vi.fn();

		render(
			<LoginView
				redirect="https://evil.example/steal"
				navigate={navigate}
				auth={authState({
					status: "unauthenticated",
					isOperator: false,
				})}
			/>,
		);

		expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
		expect(navigate).not.toHaveBeenCalled();
	});
});
