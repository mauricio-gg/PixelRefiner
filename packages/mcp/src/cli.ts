/**
 * CLI の入口。
 * [Policy] bin/pixel-refiner.mjs は dist/cli.js の main だけを見る。中身は cli/ 配下へ
 * 置き、この 1 ファイルは公開する形（main(argv) が終了コードを返す）を固定する役目に絞る。
 */
export { type CliIo, main } from "./cli/main";
