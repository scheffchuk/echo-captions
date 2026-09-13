import { useForm } from "@tanstack/react-form";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { EchoWordmark } from "@/components/echo-wordmark";
import { PageLoading } from "@/components/loading-states";
import { OperatorChrome } from "@/components/operator-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	getOperatorAuthErrorMessage,
	type LoginFlow,
	useOperatorAuth,
} from "../lib/auth/operator";
import { getBrowserOrigin, normalizeReturnTo } from "../lib/auth/return-to";

const loginSearchSchema = Schema.toStandardSchemaV1(
	Schema.Struct({ redirect: Schema.optional(Schema.String) }),
);

export const Route = createFileRoute("/login")({
	validateSearch: loginSearchSchema,
	component: LoginPage,
});

export function LoginPage() {
	const navigate = useNavigate();
	const { redirect } = Route.useSearch();
	const {
		status,
		isOperator,
		defaultFlow,
		canSignUp,
		signInWithPassword,
		signOut,
	} = useOperatorAuth();
	const destination = normalizeReturnTo(redirect, getBrowserOrigin());
	const hasNavigated = useRef(false);

	useEffect(() => {
		if (
			status === "authenticated" &&
			isOperator === true &&
			!hasNavigated.current
		) {
			hasNavigated.current = true;
			void navigate({ href: destination });
		}
	}, [destination, isOperator, navigate, status]);

	if (status === "authenticated" && isOperator === false) {
		return <OperatorAccessDenied onSignOut={signOut} />;
	}

	if (status !== "unauthenticated" || defaultFlow === "loading") {
		return <PageLoading />;
	}

	return (
		<LoginForm
			canSignUp={canSignUp}
			defaultFlow={defaultFlow}
			signInWithPassword={signInWithPassword}
		/>
	);
}

function OperatorAccessDenied({
	onSignOut,
}: {
	onSignOut: () => Promise<void>;
}) {
	return (
		<OperatorChrome className="flex items-center justify-center p-6">
			<div className="w-full max-w-md space-y-4">
				<EchoWordmark subtitle="This account can’t operate Echo." />
				<Button
					type="button"
					className="w-full"
					onClick={() => void onSignOut()}
				>
					Sign out
				</Button>
			</div>
		</OperatorChrome>
	);
}

function loginSchema() {
	return Schema.toStandardSchemaV1(
		Schema.Struct({
			email: Schema.String.check(
				Schema.isMinLength(1, { message: "Email is required" }),
			),
			password: Schema.String.check(
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

export function LoginForm({
	canSignUp,
	defaultFlow,
	signInWithPassword,
}: {
	canSignUp: boolean;
	defaultFlow: LoginFlow;
	signInWithPassword: (args: {
		email: string;
		password: string;
		flow: LoginFlow;
	}) => Promise<void>;
}) {
	const [flow, setFlow] = useState<LoginFlow>(
		canSignUp ? defaultFlow : "signIn",
	);
	const form = useForm({
		defaultValues: { email: "", password: "" },
		validators: { onSubmit: loginSchema() },
		onSubmit: async ({ value, formApi }) => {
			formApi.setErrorMap({ onSubmit: undefined });
			try {
				await signInWithPassword({
					email: value.email,
					password: value.password,
					flow,
				});
			} catch (error) {
				formApi.setErrorMap({
					onSubmit: { form: getOperatorAuthErrorMessage(error), fields: {} },
				});
			}
		},
	});

	const creating = flow === "signUp";

	return (
		<OperatorChrome className="flex items-center justify-center p-6">
			<div className="w-full max-w-md">
				<div className="mb-8">
					<EchoWordmark
						subtitle={
							creating
								? "Create an account to run captions."
								: "Sign in to run captions."
						}
					/>
				</div>

				<form
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<>
								<form.Field name="email">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="email" className="sr-only">
												Email
											</Label>
											<Input
												id="email"
												name="email"
												type="email"
												autoComplete="username"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												placeholder="Email"
												required
												disabled={isSubmitting}
												className="w-full"
											/>
											<FieldErrors errors={field.state.meta.errors} />
										</div>
									)}
								</form.Field>
								<form.Field name="password">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="password" className="sr-only">
												Password
											</Label>
											<Input
												id="password"
												name="password"
												type="password"
												autoComplete={
													creating ? "new-password" : "current-password"
												}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												placeholder="Password"
												required
												minLength={8}
												disabled={isSubmitting}
												className="w-full"
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
								<Button
									type="submit"
									className="w-full"
									disabled={isSubmitting}
								>
									{isSubmitting
										? creating
											? "Creating account…"
											: "Signing in…"
										: creating
											? "Create account"
											: "Sign in"}
								</Button>
								{canSignUp ? (
									<Button
										type="button"
										variant="ghost"
										className="w-full"
										disabled={isSubmitting}
										onClick={() =>
											setFlow((current) =>
												current === "signUp" ? "signIn" : "signUp",
											)
										}
									>
										{creating
											? "Already have an account? Sign in"
											: "Need an account? Create one"}
									</Button>
								) : null}
							</>
						)}
					</form.Subscribe>
				</form>
			</div>
		</OperatorChrome>
	);
}
