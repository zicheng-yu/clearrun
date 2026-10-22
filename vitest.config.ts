import { defineConfig } from "vitest/config";

// Engine tests run in Node against the synthetic transport; no Workers runtime needed.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
	},
});
