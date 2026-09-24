import workpool from "@convex-dev/workpool/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		ELEVENLABS_API_KEY: v.optional(v.string()),
		GOOGLE_APPLICATION_CREDENTIALS_JSON: v.optional(v.string()),
		GOOGLE_CLOUD_PROJECT_ID: v.optional(v.string()),
		ALLOW_SIGNUP: v.optional(v.string()),
	},
});

app.use(workpool, { name: "captionWorkpool" });

app.use(workpool, { name: "captionRetryWorkpool" });

export default app;
