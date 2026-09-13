import { execSync } from "node:child_process";

function run(command) {
	execSync(command, { stdio: "inherit", env: process.env });
}

if (process.env.CONVEX_DEPLOY_KEY) {
	run(
		"node node_modules/convex/bin/main.js deploy --cmd 'node node_modules/vite/bin/vite.js build'",
	);
} else {
	console.warn(
		"CONVEX_DEPLOY_KEY not set; building TanStack Start without Convex deploy",
	);
	run("node node_modules/vite/bin/vite.js build");
}
