import {
	listOptions,
	type OptionsListing,
	type OptionsSection,
} from "../engine/option-listing";
import type { OperationResult } from "../failure";

/** listOptions が受け付ける節。JSON 経由では型で守れないので実行時にも確かめる。 */
const SECTIONS: readonly OptionsSection[] = [
	"all",
	"presets",
	"palettes",
	"quick",
	"advanced",
];

export type ListOptionsArgs = {
	section: OptionsSection;
};

/**
 * 設定の語彙を返す。
 * [Policy] 他の操作と同じ OperationResult に包む。transport 側が 4 つの操作を同じ形で
 * 扱えるようにするためで、この操作自体はファイルにもエンジンにも触れない。
 */
export const runListOptions = async (
	args: ListOptionsArgs,
): Promise<OperationResult<OptionsListing>> => {
	if (!SECTIONS.includes(args.section)) {
		return {
			ok: false,
			failure: {
				code: "INVALID_SETTINGS",
				message: `section must be one of: ${SECTIONS.join(", ")}.`,
			},
		};
	}
	return { ok: true, value: listOptions(args.section) };
};
