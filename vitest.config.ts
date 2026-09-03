import { configDefaults, defineConfig } from "vitest/config";

// [Policy] 共有CIランナーでは画像処理テストがCPU競合で遅くなるため、CI時だけ待機上限を延長する。
const testTimeout = process.env.CI === "true" ? 60_000 : 15_000;

export default defineConfig({
	test: {
		environment: "node",
		testTimeout,
		// [Policy] packages/mcp は sharp 依存の独自 vitest 設定・依存関係を持つため、
		// ルートの単体テストから除外し `pnpm --filter pixel-refiner-mcp test` に任せる。
		exclude: [...configDefaults.exclude, "packages/**"],
	},
});
