import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
	PasswordInput,
	PasswordInputControl,
	PasswordInputToggle,
} from "@/components/ui/password-input";
import { getOperatorAuthErrorMessage } from "../src/lib/auth/operator";

export function ChangePasswordForm({
	onChangePassword,
	onDone,
}: {
	onChangePassword: (args: {
		currentPassword: string;
		newPassword: string;
	}) => Promise<void>;
	onDone: () => void;
}) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [showValidation, setShowValidation] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (isSubmitting) return;

		if (currentPassword.length < 8 || newPassword.length < 8) {
			setShowValidation(true);

			return;
		}

		setSubmitError(null);
		setIsSubmitting(true);

		try {
			await onChangePassword({ currentPassword, newPassword });
			setIsSubmitting(false);
			onDone();
		} catch (error) {
			setIsSubmitting(false);
			setSubmitError(getOperatorAuthErrorMessage(error));
		}
	};

	const currentInvalid = showValidation && currentPassword.length < 8;
	const newInvalid = showValidation && newPassword.length < 8;

	return (
		<form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
			<Field name="currentPassword" invalid={currentInvalid || undefined}>
				<FieldLabel htmlFor="current-password">Current password</FieldLabel>
				<PasswordInput
					name="currentPassword"
					autoComplete="current-password"
					value={currentPassword}
					onValueChange={(value) => setCurrentPassword(value)}
					required
					disabled={isSubmitting}
				>
					<PasswordInputControl
						id="current-password"
						minLength={8}
						onInvalid={() => setShowValidation(true)}
					/>
					<PasswordInputToggle aria-label="Show current password" />
				</PasswordInput>
				{currentInvalid ? (
					<FieldError>Password must be at least 8 characters</FieldError>
				) : null}
			</Field>
			<Field name="newPassword" invalid={newInvalid || undefined}>
				<FieldLabel htmlFor="new-password">New password</FieldLabel>
				<PasswordInput
					name="newPassword"
					autoComplete="new-password"
					value={newPassword}
					onValueChange={(value) => setNewPassword(value)}
					required
					disabled={isSubmitting}
				>
					<PasswordInputControl
						id="new-password"
						minLength={8}
						onInvalid={() => setShowValidation(true)}
					/>
					<PasswordInputToggle aria-label="Show new password" />
				</PasswordInput>
				{newInvalid ? (
					<FieldError>Password must be at least 8 characters</FieldError>
				) : null}
			</Field>
			{submitError ? (
				<div
					role="alert"
					className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
				>
					{submitError}
				</div>
			) : null}
			<Button type="submit" className="w-full" disabled={isSubmitting}>
				{isSubmitting ? "Saving…" : "Save password"}
			</Button>
		</form>
	);
}
