import { defineConfig } from "tsdown";

// [Policy] entry は package.json が公開する 3 つの入口と 1 対 1 で対応させる。index は
// exports["."]、mcp は bin/pixel-refiner-mcp.mjs、cli は bin/pixel-refiner.mjs が読む。
// bin が指す先を必ず生成するため、ここへ足し忘れると publish 後にだけ壊れる。
export default defineConfig({
	entry: ["src/index.ts", "src/mcp.ts", "src/cli.ts"],
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
	// [Workaround] 旧 external は tsdown 0.23 で deprecated になったため deps.neverBundle を使う。
	// sharp はネイティブバイナリを持つので同梱できず、SDK と zod は publish 時に依存として
	// 解決されるべきものなので、いずれもバンドルへ取り込まない。
	deps: { neverBundle: ["sharp", /^@modelcontextprotocol\//, "zod"] },
});
