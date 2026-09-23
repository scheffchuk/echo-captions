import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { type FormEvent, useEffect, useRef, useState } from "react";
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
	const auth = useOperatorAuth();

	return (
		<LoginView
			redirect={redirect}
			navigate={(options) => {
				void navigate(options);
			}}
			auth={auth}
		/>
	);
}

export function LoginView({
	redirect,
	navigate,
	auth,
}: {
	redirect: string | undefined;
	navigate: (options: { href: string }) => void;
	auth: ReturnType<typeof useOperatorAuth>;
}) {
	const {
		status,
		isOperator,
		defaultFlow,
		canSignUp,
		signInWithPassword,
		signOut,
	} = auth;

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

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [showValidation, setShowValidation] = useState(false);

	const creating = flow === "signUp";

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (isSubmitting) return;

		if (email.length === 0 || password.length < 8) {
			setShowValidation(true);

			return;
		}

		setSubmitError(null);
		setIsSubmitting(true);

		try {
			await signInWithPassword({ email, password, flow });
		} catch (error) {
			setSubmitError(getOperatorAuthErrorMessage(error));
		} finally {
			setIsSubmitting(false);
		}
	};

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
					onSubmit={(event) => void handleSubmit(event)}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="email" className="sr-only">
							Email
						</Label>
						<Input
							id="email"
							name="email"
							type="email"
							autoComplete="username"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							onInvalid={() => setShowValidation(true)}
							placeholder="Email"
							required
							disabled={isSubmitting}
							className="w-full"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="password" className="sr-only">
							Password
						</Label>
						<Input
							id="password"
							name="password"
							type="password"
							autoComplete={creating ? "new-password" : "current-password"}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							onInvalid={() => setShowValidation(true)}
							placeholder="Password"
							required
							minLength={8}
							disabled={isSubmitting}
							className="w-full"
						/>
						{showValidation && password.length < 8 ? (
							<p className="text-sm text-destructive">
								Password must be at least 8 characters
							</p>
						) : null}
					</div>
					{showValidation && email.length === 0 ? (
						<p className="text-sm text-destructive">Email is required</p>
					) : null}
					{submitError ? (
						<div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
							{submitError}
						</div>
					) : null}
					<Button type="submit" className="w-full" disabled={isSubmitting}>
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
				</form>
			</div>
		</OperatorChrome>
	);
}
