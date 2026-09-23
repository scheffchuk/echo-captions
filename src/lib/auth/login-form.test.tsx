// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../../routes/login";

describe("LoginForm", () => {
	afterEach(() => {
		cleanup();
	});

	it("requires email and a long enough password before submitting", async () => {
		const signInWithPassword = vi.fn();
		const user = userEvent.setup();
		render(
			<LoginForm
				canSignUp={false}
				defaultFlow="signIn"
				signInWithPassword={signInWithPassword}
			/>,
		);

		const form = screen.getByPlaceholderText("Email").closest("form");
		expect(form).not.toHaveAttribute("novalidate");

		await user.type(screen.getByPlaceholderText("Password"), "short");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		expect(screen.getByPlaceholderText("Email")).toBeInvalid();
		expect(screen.getByText("Email is required")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
			"minlength",
			"8",
		);
		expect(
			screen.getByText("Password must be at least 8 characters"),
		).toBeInTheDocument();
		expect(signInWithPassword).not.toHaveBeenCalled();
	});

	it("hides account creation when signup is closed", () => {
		render(
			<LoginForm
				canSignUp={false}
				defaultFlow="signIn"
				signInWithPassword={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Need an account? Create one" }),
		).not.toBeInTheDocument();
		expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
			"autocomplete",
			"current-password",
		);
	});

	it("submits email and password for sign-in", async () => {
		const signInWithPassword = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(
			<LoginForm
				canSignUp={false}
				defaultFlow="signIn"
				signInWithPassword={signInWithPassword}
			/>,
		);

		await user.type(
			screen.getByPlaceholderText("Email"),
			"operator@echo.example",
		);
		await user.type(screen.getByPlaceholderText("Password"), "password123");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() =>
			expect(signInWithPassword).toHaveBeenCalledWith({
				email: "operator@echo.example",
				password: "password123",
				flow: "signIn",
			}),
		);
	});

	it("can switch to create-account when signup is open", async () => {
		const signInWithPassword = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(
			<LoginForm
				canSignUp
				defaultFlow="signIn"
				signInWithPassword={signInWithPassword}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "Need an account? Create one" }),
		);
		expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
			"autocomplete",
			"new-password",
		);

		await user.type(
			screen.getByPlaceholderText("Email"),
			"operator@echo.example",
		);
		await user.type(screen.getByPlaceholderText("Password"), "password123");
		await user.click(screen.getByRole("button", { name: "Create account" }));

		await waitFor(() =>
			expect(signInWithPassword).toHaveBeenCalledWith({
				email: "operator@echo.example",
				password: "password123",
				flow: "signUp",
			}),
		);
	});

	it("keeps a failed sign-in visible while allowing a corrected retry", async () => {
		const signInWithPassword = vi
			.fn()
			.mockRejectedValueOnce(new Error("Invalid credentials"))
			.mockResolvedValueOnce(undefined);

		const user = userEvent.setup();
		render(
			<LoginForm
				canSignUp={false}
				defaultFlow="signIn"
				signInWithPassword={signInWithPassword}
			/>,
		);

		const email = screen.getByPlaceholderText("Email");
		const password = screen.getByPlaceholderText("Password");
		await user.type(email, "operator@echo.example");
		await user.type(password, "wrongpass");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() =>
			expect(
				screen.getByText("That email or password wasn’t recognized."),
			).toBeInTheDocument(),
		);
		expect(password).toHaveValue("wrongpass");

		await user.clear(password);
		await user.type(password, "correctpass");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(2));
		expect(
			screen.queryByText("That email or password wasn’t recognized."),
		).not.toBeInTheDocument();
	});

	it("prevents duplicate sign-in actions while submission is pending", async () => {
		let resolveSignIn!: () => void;

		const signInWithPassword = vi.fn().mockReturnValue(
			new Promise<void>((resolve) => {
				resolveSignIn = resolve;
			}),
		);

		const user = userEvent.setup();
		render(
			<LoginForm
				canSignUp
				defaultFlow="signIn"
				signInWithPassword={signInWithPassword}
			/>,
		);

		await user.type(
			screen.getByPlaceholderText("Email"),
			"operator@echo.example",
		);
		await user.type(screen.getByPlaceholderText("Password"), "password123");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		const submitButton = screen.getByRole("button", { name: "Signing in…" });
		await waitFor(() => expect(submitButton).toBeDisabled());
		expect(
			screen.getByRole("button", { name: "Need an account? Create one" }),
		).toBeDisabled();
		await user.click(submitButton);
		expect(signInWithPassword).toHaveBeenCalledTimes(1);

		resolveSignIn();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled(),
		);
	});
});
