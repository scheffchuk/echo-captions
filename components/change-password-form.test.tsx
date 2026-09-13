// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "./change-password-form";

describe("ChangePasswordForm", () => {
	afterEach(() => {
		cleanup();
	});

	it("rejects short passwords before calling the auth action", async () => {
		const onChangePassword = vi.fn();
		const user = userEvent.setup();
		render(
			<ChangePasswordForm
				onChangePassword={onChangePassword}
				onDone={vi.fn()}
			/>,
		);

		await user.type(screen.getByLabelText("Current password"), "short");
		await user.type(screen.getByLabelText("New password"), "short");
		await user.click(screen.getByRole("button", { name: "Save password" }));

		expect(
			screen.getAllByText("Password must be at least 8 characters"),
		).toHaveLength(2);
		expect(onChangePassword).not.toHaveBeenCalled();
	});

	it("saves a valid password change", async () => {
		const onChangePassword = vi.fn().mockResolvedValue(undefined);
		const onDone = vi.fn();
		const user = userEvent.setup();
		render(
			<ChangePasswordForm
				onChangePassword={onChangePassword}
				onDone={onDone}
			/>,
		);

		await user.type(screen.getByLabelText("Current password"), "oldpass12");
		await user.type(screen.getByLabelText("New password"), "newpass12");
		await user.click(screen.getByRole("button", { name: "Save password" }));

		await waitFor(() =>
			expect(onChangePassword).toHaveBeenCalledWith({
				currentPassword: "oldpass12",
				newPassword: "newpass12",
			}),
		);
		expect(onDone).toHaveBeenCalled();
	});
});
