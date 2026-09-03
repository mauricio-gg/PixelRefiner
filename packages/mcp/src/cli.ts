/**
 * CLI の入口。
 * [Workaround] 本体は次のタスクで入る。package.json の bin と bin/pixel-refiner.mjs は
 * 先に確定していて、実体の無いファイルを指す bin は publish できないため、当面は
 * 使い方エラー（終了コード 2）で止める仮の入口を置いておく。引数の形だけは本実装と
 * 揃えてあるので、bin 側は差し替え後もそのまま使える。
 */
export const main = (_argv: readonly string[]): void => {
	process.stderr.write(
		"[pixel-refiner] error the CLI arrives in the next release; use the MCP server for now\n",
	);
	process.exit(2);
};
