/**
 * パッケージのバージョン。
 * [Policy] package.json を import すると bundler と型解決の両方に条件が増えるので、
 * 定数として置き、公開時に package.json と揃える。MCP の initialize が返す
 * serverInfo.version にもこの値がそのまま載る。
 */
export const PIXEL_REFINER_MCP_VERSION = "0.1.0";
