/**
 * pixel-refiner-mcp の公開エントリーポイント。
 *
 * [Workaround] 本来はここで engine の設定 API（resolveSettings / listOptions /
 * ADVANCED_OPTION_SPECS と型一式）を re-export するが、現在の dts 生成では通らない。
 * tsdown.config.ts の [Workaround] のとおり型定義は oxc の isolatedDeclarations 生成器で
 * 作っており、この生成器は「エントリーから辿れるすべてのモジュール」に isolated declarations
 * の制約を課す。engine は ../../../src/core と ../../../src/browser/quick-settings.ts を
 * 参照する（型だけの import でも辿られる）ため、ルート側の未注釈な export が
 * そのままエラーになる。実測した例:
 *   TS9007 src/core/processor-options.ts:236 createDefaultProcessOptions
 *   TS9010 src/core/processor.ts:746        export const processImage = processImageCore;
 *   TS9008 src/browser/i18n/index.ts:37     registerMessages(messages: MessageCatalog)
 * これらへ注釈を足しても次の未注釈な export が現れる（TS9011 processor-options.ts:619 など）ため、
 * 1 箇所の修正では済まない。engine の re-export は dts 生成の方式を決め直してから行う。
 */
export const PIXEL_REFINER_MCP_VERSION = "0.1.0";
