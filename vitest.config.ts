import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "."),
		},
	},
	test: {
		environment: "edge-runtime",
		setupFiles: ["./vitest.setup.ts"],
		projects: [
			{
				extends: true,
				test: {
					name: "app",
					include: ["**/*.{test,spec}.{ts,tsx}"],
					exclude: [
						"hooks/use-realtime-connection.native.test.tsx",
						"node_modules/**",
					],
				},
			},
			{
				extends: true,
				test: {
					name: "native-scribe",
					environment: "jsdom",
					include: ["hooks/use-realtime-connection.native.test.tsx"],
					execArgv: ["--conditions=browser"],
				},
			},
		],
	},
});
