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
	// [Workaround] 型定義は tsdown ではなく別の tsc 実行（tsconfig.dts.json）で出力する。
	// tsdown の dts 生成器はどちらもこの構成に合わない：oxc（isolatedDeclarations）は
	// エントリーから辿れるルートの src/core・src/browser にまで注釈を要求してエラーになり、
	// tsgo（TypeScript 7 で既定に選ばれる）は --rootDir が packages/mcp に固定されるため
	// ルートのソースの隣へ .d.ts を書き出してしまう。tsconfig.dts.json は rootDir を
	// リポジトリルートに置くので、出力は dist/types 配下だけで完結する。
	dts: false,
	external: ["sharp", /^@modelcontextprotocol\//, "zod"],
});
