import { defineConfig } from "vitest/config";

// [Policy] e2e ケースは guide 用の 2048px 入力を扱うため、root より長めのタイムアウトを取る。
const testTimeout = process.env.CI === "true" ? 120_000 : 60_000;

export default defineConfig({
	test: {
		environment: "node",
		testTimeout,
	},
});
