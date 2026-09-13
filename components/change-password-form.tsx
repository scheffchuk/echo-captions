import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOperatorAuthErrorMessage } from "../src/lib/auth/operator";

function passwordSchema() {
	return Schema.toStandardSchemaV1(
		Schema.Struct({
			currentPassword: Schema.String.check(
				Schema.isMinLength(8, {
					message: "Password must be at least 8 characters",
				}),
			),
			newPassword: Schema.String.check(
				Schema.isMinLength(8, {
					message: "Password must be at least 8 characters",
				}),
			),
		}),
	);
}

function validationErrorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return String(error);
}

function FieldErrors({ errors }: { errors: unknown[] }) {
	if (errors.length === 0) return null;
	return (
		<div className="space-y-1 text-sm text-destructive">
			{errors.map((error) => (
				<p key={validationErrorMessage(error)}>
					{validationErrorMessage(error)}
				</p>
			))}
		</div>
	);
}

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
	const form = useForm({
		defaultValues: { currentPassword: "", newPassword: "" },
		validators: { onSubmit: passwordSchema() },
		onSubmit: async ({ value, formApi }) => {
			formApi.setErrorMap({ onSubmit: undefined });
			try {
				await onChangePassword(value);
				onDone();
			} catch (error) {
				formApi.setErrorMap({
					onSubmit: { form: getOperatorAuthErrorMessage(error), fields: {} },
				});
			}
		},
	});

	return (
		<form
			noValidate
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<>
						<form.Field name="currentPassword">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="current-password">Current password</Label>
									<Input
										id="current-password"
										name="currentPassword"
										type="password"
										autoComplete="current-password"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										disabled={isSubmitting}
									/>
									<FieldErrors errors={field.state.meta.errors} />
								</div>
							)}
						</form.Field>
						<form.Field name="newPassword">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="new-password">New password</Label>
									<Input
										id="new-password"
										name="newPassword"
										type="password"
										autoComplete="new-password"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										disabled={isSubmitting}
									/>
									<FieldErrors errors={field.state.meta.errors} />
								</div>
							)}
						</form.Field>
						<form.Subscribe selector={(state) => state.errorMap.onSubmit}>
							{(error) =>
								error ? (
									<div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
										{validationErrorMessage(
											typeof error === "object" &&
												error !== null &&
												"form" in error
												? error.form
												: error,
										)}
									</div>
								) : null
							}
						</form.Subscribe>
						<Button type="submit" className="w-full" disabled={isSubmitting}>
							{isSubmitting ? "Saving…" : "Save password"}
						</Button>
					</>
				)}
			</form.Subscribe>
		</form>
	);
}
