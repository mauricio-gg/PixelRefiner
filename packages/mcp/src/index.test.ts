import { describe, expect, it } from "vitest";
import { PIXEL_REFINER_MCP_VERSION } from "./index";

describe("PIXEL_REFINER_MCP_VERSION", () => {
	it("プレースホルダーのバージョン文字列を公開する", () => {
		expect(PIXEL_REFINER_MCP_VERSION).toBe("0.1.0");
	});
});
