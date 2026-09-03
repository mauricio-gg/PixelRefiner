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
	// [Workaround] tsconfig.json は "isolatedDeclarations" を付けない（tsc --noEmit の
	// 通常の型チェックでは root の src/core・src/shared にまで isolated declarations の
	// 制約を強制したくない）。だが dts 生成だけは isolatedDeclarations を付けて
	// generator を oxc に切り替える必要がある：既定では TypeScript 7 系がインストール
	// されていると tsgo（ネイティブコンパイラの CLI）が選ばれ、tsgo は一時ディレクトリへ
	// プロジェクト全体を disk 経由で emit する。その際 --rootDir は tsconfig.json の
	// 置き場所（packages/mcp）に固定され、root の src/core・src/shared・test/quality
	// は rootDir の外側になるため、TypeScript は出力先を tsgoDist 配下へ再配置できず
	// 元のソースの隣に直接 .d.ts を書き出してしまう（io/ が core/shared を相対 import
	// するようになった Task 4 で顕在化）。oxc の isolatedDeclarations 生成器はファイル
	// 単位でメモリ上だけ完結するため、この問題が起きない。ここでの compilerOptions は
	// dts 生成専用の上書きで、tsconfig.json ファイル自体や `tsc --noEmit` には影響しない。
	dts: { compilerOptions: { isolatedDeclarations: true, declaration: true } },
	external: ["sharp", /^@modelcontextprotocol\//, "zod"],
});
