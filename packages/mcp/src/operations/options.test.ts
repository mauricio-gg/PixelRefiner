import { describe, expect, it } from "vitest";
import type { OptionsSection } from "../engine/option-listing";
import { runListOptions } from "./options";

describe("runListOptions", () => {
	it("指定した節だけを返す", async () => {
		const result = await runListOptions({ section: "presets" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.presets?.length).toBeGreaterThan(0);
		expect(result.value.palettes).toBeUndefined();
		expect(result.value.quick).toBeUndefined();
		expect(result.value.advanced).toBeUndefined();
	});

	it("all は 4 つの節をすべて返す", async () => {
		const result = await runListOptions({ section: "all" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.presets?.length).toBeGreaterThan(0);
		expect(result.value.palettes?.length).toBeGreaterThan(0);
		expect(result.value.quick?.length).toBeGreaterThan(0);
		expect(result.value.advanced?.length).toBeGreaterThan(0);
	});

	it("未知の節は INVALID_SETTINGS", async () => {
		const section = "colors" as unknown as OptionsSection;

		const result = await runListOptions({ section });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.code).toBe("INVALID_SETTINGS");
		expect(result.failure.message).toContain("section");
	});
});
