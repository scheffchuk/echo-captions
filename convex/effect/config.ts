import { ConfigProvider, Effect, Layer } from "effect";
import { env } from "../_generated/server";

// Convex's V8 runtime does not implement import.meta. Effect's default
// provider also reads import.meta.env, so install an explicit provider from
// Convex's environment instead. The provider must be built lazily: Convex
// evaluates module scope during deployment analysis, before deployment env
// vars are available.
export const convexConfigLayer = Layer.unwrap(
	Effect.sync(() =>
		ConfigProvider.layer(
			ConfigProvider.fromEnvRecord({
				ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY,
				GOOGLE_APPLICATION_CREDENTIALS_JSON:
					env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
				GOOGLE_CLOUD_PROJECT_ID: env.GOOGLE_CLOUD_PROJECT_ID,
			}),
		),
	),
);
