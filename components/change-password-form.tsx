import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

	return (
		<form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
			<div className="space-y-2">
				<Label htmlFor="current-password">Current password</Label>
				<Input
					id="current-password"
					name="currentPassword"
					type="password"
					autoComplete="current-password"
					value={currentPassword}
					onChange={(event) => setCurrentPassword(event.target.value)}
					onInvalid={() => setShowValidation(true)}
					required
					minLength={8}
					disabled={isSubmitting}
				/>
				{showValidation && currentPassword.length < 8 ? (
					<p className="text-sm text-destructive">
						Password must be at least 8 characters
					</p>
				) : null}
			</div>
			<div className="space-y-2">
				<Label htmlFor="new-password">New password</Label>
				<Input
					id="new-password"
					name="newPassword"
					type="password"
					autoComplete="new-password"
					value={newPassword}
					onChange={(event) => setNewPassword(event.target.value)}
					onInvalid={() => setShowValidation(true)}
					required
					minLength={8}
					disabled={isSubmitting}
				/>
				{showValidation && newPassword.length < 8 ? (
					<p className="text-sm text-destructive">
						Password must be at least 8 characters
					</p>
				) : null}
			</div>
			{submitError ? (
				<div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
					{submitError}
				</div>
			) : null}
			<Button type="submit" className="w-full" disabled={isSubmitting}>
				{isSubmitting ? "Saving…" : "Save password"}
			</Button>
		</form>
	);
}
