#!/usr/bin/env node
import { main } from "../dist/cli.js";

// [Intended] トップレベル await にはしない。serve は停止まで解決しない約束を返すので、
// stdin が閉じてイベントループが空になった瞬間に Node が "unsettled top-level await" を
// stderr へ書いてしまう。then で受ければ同じ終了コードのまま、その警告が出ない。
// [Intended] process.exit ではなく exitCode に入れる。exit は書き出し途中の stdout を
// 切り捨てるので、パイプの相手が JSON を読み切れないことがある。
main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`[pixel-refiner] error ${message}\n`);
		process.exitCode = 1;
	},
);
