import { defineConfig } from "tsdown";

// [Policy] entry の mcp / cli は Task 9/10 で src/mcp.ts, src/cli.ts が追加されてから登録する。
// tsdown は存在しないエントリーファイルをビルドエラーにするため、現時点では index のみを対象にする。
export default defineConfig({
	entry: ["src/index.ts"],
	format: "esm",
	platform: "node",
	target: "node24",
	// [Policy] platform: "node" だと既定で拡張子が .mjs 固定になるが、package.json が
	// "type": "module" のため .js のままで ESM として解決できる。exports["."] や
	// Makefile の comlink 混入チェックが参照する dist/index.js と一致させる。
	fixedExtension: false,
	dts: true,
	external: ["sharp", /^@modelcontextprotocol\//, "zod"],
});
