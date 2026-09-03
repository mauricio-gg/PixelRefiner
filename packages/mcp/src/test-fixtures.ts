import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "./engine/engine";
import { createLogger } from "./log";
import type { OperationDeps } from "./operations/shared";

/**
 * テスト用の小さな置き場。
 * [Policy] 本番のバンドル対象（src/index.ts から辿れる範囲）には入れない。ここを経由するのは
 * テストだけなので、リポジトリのフィクスチャ参照と一時ディレクトリの後始末をまとめておく。
 */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const repositoryPath = (relative: string): string =>
	path.join(REPOSITORY_ROOT, relative);

export const fixtureBytes = (relative: string): Uint8Array =>
	new Uint8Array(readFileSync(repositoryPath(relative)));

export type TempDirs = {
	create: () => string;
	cleanup: () => void;
};

/** 作った一時ディレクトリを覚えて、まとめて消せるようにする。 */
export const tempDirs = (): TempDirs => {
	const created: string[] = [];
	return {
		create: () => {
			const directory = mkdtempSync(path.join(tmpdir(), "pixel-refiner-"));
			created.push(directory);
			return directory;
		},
		cleanup: () => {
			while (created.length > 0) {
				const directory = created.pop();
				if (directory !== undefined) {
					rmSync(directory, { recursive: true, force: true });
				}
			}
		},
	};
};

/**
 * 操作層の依存一式。エンジンは呼び出しごとに作り、テスト間でキャッシュを共有しない。
 * [Policy] ログは silent。テスト出力に混ぜない。
 */
export const operationDeps = (cwd: string): OperationDeps => ({
	engine: createEngine(),
	policy: { mode: "mcp", cwd },
	log: createLogger("silent"),
});
