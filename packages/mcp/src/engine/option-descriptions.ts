import { RETRO_PALETTES } from "../../../../src/shared/config";
import type {
	AutoBehaviorSetting,
	BackgroundRemovalScope,
	BgExtractionMethod,
	CellSamplingMode,
	CellScale,
	Connectivity,
	DetailLevel,
	DitherMode,
	GeminiWatermarkRemovalMode,
	OutlineStyle,
	ProcessingMode,
	SmallComponentRemovalMode,
} from "../../../../src/shared/types";
import type { AdvancedOptionKey } from "./types";

/**
 * AI 向けのオプション説明文。
 * [Policy] 表示用の訳文（src/browser/i18n）とは目的が違うので共有しない。読み手は
 * 人間ではなくモデルで、「何をするか」より「いつ変えるか・経路とどう絡むか」が要る。
 * そのため英語の散文で書き、i18n のキーとは独立に保つ。
 */
export const OPTION_DESCRIPTIONS: Readonly<Record<AdvancedOptionKey, string>> =
	{
		processingMode:
			"Which pipeline to run. 'auto' classifies the input and picks one; set it explicitly when auto keeps choosing the wrong route.",
		detailLevel:
			"Logical resolution preset for the convert route. Ignored by refine and preserve. Use convertPixelsW/H for an exact size.",
		cellScale:
			"Multiplier applied to the detected cell size on the refine route. Use it when the grid was detected at 2x or 1/2 of the real dot size.",
		convertPixelsW:
			"Exact output width in logical pixels for the convert route. If only one axis is given, the other follows the aspect ratio.",
		convertPixelsH:
			"Exact output height in logical pixels for the convert route. If only one axis is given, the other follows the aspect ratio.",
		detectionQuantStep:
			"Posterisation steps used while detecting the grid. Lower values merge near-identical colours and help on noisy or gradient art.",
		autoMaxCellsW:
			"Upper bound on the detected number of cells along the x axis. Lower it to stop the detector from locking onto a far too fine grid.",
		autoMaxCellsH:
			"Upper bound on the detected number of cells along the y axis. Lower it to stop the detector from locking onto a far too fine grid.",
		backgroundMask:
			"Guess the dominant background colour and mask it before grid detection, so a noisy background does not drown the grid signal.",
		backgroundMaskTolerance:
			"Per-channel tolerance for that detection-time background mask. Raise it when the background is a soft gradient rather than a flat colour.",
		enableGridDetection:
			"Run grid detection and downsampling at all. Turn it off for art that is already at its logical resolution; trimming and transparency still run.",
		forcePixelsW:
			"Force the output width in logical pixels and skip grid detection. Both forcePixelsW and forcePixelsH must be given together.",
		forcePixelsH:
			"Force the output height in logical pixels and skip grid detection. Both forcePixelsW and forcePixelsH must be given together.",
		hintPixelsW:
			"Start the automatic grid search near this output width. Unlike forcePixelsW, detection still runs and may land on a nearby size.",
		hintPixelsH:
			"Start the automatic grid search near this output height. Unlike forcePixelsH, detection still runs and may land on a nearby size.",
		autoGridFromTrimmed:
			"Estimate the output grid from the content bounds left after background removal instead of from the whole canvas.",
		fastAutoGridFromTrimmed:
			"Use the faster search for that estimate. Turn it off to fall back to the older, slower search when the fast one picks a wrong size.",
		phaseAwareGridSearch:
			"Search grid phase as well as period, and prefer that result over the reconstruction-based one when the per-axis confidence is high.",
		boundaryContrastOverride:
			"Allow switching to a coarser harmonic of the detected grid when its cell boundaries line up with real edges clearly better.",
		smallAspectGridAlignment:
			"For very small logical resolutions, align the grid to the corner seed mask boundary rather than the raw canvas.",
		watermarkSamplingCompat:
			"After a watermark removal, switch to the compatibility sampler that keeps the last row from being dropped.",
		sampleWindow:
			"Median window size used when sampling each cell's colour. Larger windows smooth away noise but can blur one-pixel details.",
		cellSamplingMode:
			"How a cell's single output colour is chosen from the pixels it covers. This is the main knob for anti-aliasing fringes.",
		maxSamplesPerCell:
			"Upper bound on how many pixels are inspected per cell. Lower it for speed on very large inputs; it only affects sampling accuracy.",
		cellAlphaThreshold:
			"Minimum alpha for a pixel to count as a colour candidate inside a cell. Raise it to ignore faint anti-aliasing haloes.",
		preserveThinFeatures:
			"Protect minority colours that cross a cell, so one-pixel outlines and thin lines survive downsampling.",
		preRemoveBackground:
			"Remove the background at the source resolution, before downsampling. Usually paired with postRemoveBackground.",
		postRemoveBackground:
			"Remove the background again at the output resolution, after downsampling, to clean up cells that ended up half background.",
		bgExtractionMethod:
			"How the background colour is decided. 'none' disables background handling entirely; 'rgb' uses the colour given in bgRgb.",
		bgRgb:
			"Background colour as '#rrggbb'. Only used when bgExtractionMethod is 'rgb'.",
		bgRemovalScope:
			"Which regions matching the background colour become transparent: only the outer region, every match, or nothing.",
		bgConnectivity:
			"Neighbourhood used when flood-filling the background: '4' orthogonal only, '8' including diagonals. '8' leaks through thin gaps more easily.",
		backgroundTolerance:
			"Per-channel tolerance when matching pixels against the background. Raise it for gradient backgrounds, lower it when the subject gets eaten.",
		backgroundDehalo:
			"Push edge pixels away from the background colour to remove the halo left by anti-aliasing.",
		backgroundEdgeCleanup:
			"Replace background contamination left on output edges with the true colour taken from the source resolution.",
		backgroundRampFollow:
			"Follow a smooth gradient background as a chain of small steps instead of a single flat colour.",
		backgroundRemovalRollback:
			"Undo the whole background removal when too much of the subject disappeared.",
		alphaBorderBackgroundGuard:
			"Skip colour-based background estimation when the border band is already mostly transparent.",
		backgroundConfidenceGate:
			"Skip background removal when the background model's confidence is below its threshold.",
		smallComponentBackgroundGate:
			"Skip small-component removal when the background model's confidence is below its threshold.",
		smallComponentMode:
			"Strength of the removal of small isolated components (specks) measured in logical pixels.",
		geminiWatermarkRemoval:
			"Remove the Gemini watermark when it sits as an isolated component in the bottom-right corner over transparency.",
		floatingMaxPixels:
			"Deprecated source-pixel threshold for floating noise removal. Prefer smallComponentMode; setting this alone disables the newer mode.",
		trimToContent:
			"Crop the output to the content bounding box. Turn it off to keep the full canvas, for example for background art.",
		preserveProcessingScale:
			"Decide the output size from a mask that ignores trimming and transparency, so the dot size stays the same whatever gets cropped.",
		trimAlphaThreshold:
			"Minimum alpha for a pixel to count as content when computing the trim bounding box.",
		makeSquare:
			"Pad the shorter side with transparent pixels so the output is square.",
		keepAspectRatio:
			"Pad the output with transparent pixels so it keeps the source aspect ratio.",
		reduceColors:
			"Enable colour reduction. Set together with reduceColorMode; if you set only reduceColorMode it is derived as mode !== 'none'.",
		reduceColorMode:
			"Which palette to reduce to: a retro console palette, 'auto' for k-means with colorCount colours, 'fixed' for fixedPalette, or 'none'.",
		colorCount:
			"Number of colours kept when reduceColorMode is 'auto'. Ignored by the fixed retro palettes.",
		fixedPalette:
			"Explicit palette as '#rrggbb' strings (or {r,g,b} objects). Required when reduceColorMode is 'fixed'; it overrides the mode's own palette.",
		ditherMode:
			"Dithering pattern applied during colour reduction. Dithering trades flat areas for a wider apparent colour range.",
		ditherStrength:
			"Dithering strength from 0 to 100. 0 disables dithering regardless of ditherMode.",
		outlineStyle:
			"Add an outline around the opaque content at the output resolution.",
		outlineColor:
			"Outline colour as '#rrggbb' or {r,g,b}. Only used when outlineStyle is not 'none'.",
	};

const AUTO_BEHAVIOR_VALUES: Readonly<Record<AutoBehaviorSetting, string>> = {
	auto: "Same as 'on'; kept so older saved settings still load.",
	on: "Apply the correction.",
	off: "Never apply the correction.",
};

const buildReduceColorModeDescriptions = (): Readonly<
	Record<string, string>
> => {
	const base: Record<string, string> = {
		none: "No colour reduction.",
		auto: "k-means in Oklab down to colorCount colours.",
		fixed:
			"Use the palette given in fixedPalette; fixedPalette is then required.",
	};
	// [Intended] パレット説明はレトロパレット表から生成する。手書きにすると
	// パレットを追加したときに説明だけが欠ける（型では検出できない）。
	for (const [id, palette] of Object.entries(RETRO_PALETTES)) {
		base[id] = `${palette.name} palette (${palette.colors.length} colours).`;
	}
	return base;
};

export const ENUM_VALUE_DESCRIPTIONS: Readonly<
	Record<string, Readonly<Record<string, string>>>
> = {
	processingMode: {
		auto: "Classify the input and pick refine, convert or preserve automatically.",
		refine:
			"Restore an upscaled sprite to its logical grid. Best for AI pixel art that is really a scaled-up sprite.",
		convert:
			"Pixelate continuous-tone art down to a logical resolution chosen by detailLevel or convertPixelsW/H.",
		preserve:
			"Leave the pixels as they are; only background removal, trimming and colour reduction run.",
	} satisfies Record<ProcessingMode, string>,
	detailLevel: {
		smallest: "Coarsest convert output; strongest stylisation.",
		small: "Coarse convert output.",
		coarse: "Slightly coarser than balanced.",
		balanced: "Default convert output size.",
		detailed: "Finest convert output; keeps the most shape detail.",
	} satisfies Record<DetailLevel, string>,
	cellScale: {
		quarter:
			"Quarter of the detected cell size; use when detection came out 4x too coarse.",
		half: "Half the detected cell size.",
		same: "Use the detected cell size unchanged.",
		double:
			"Twice the detected cell size; use when detection locked onto half the real dot.",
		quadruple: "Four times the detected cell size.",
	} satisfies Record<CellScale, string>,
	smallAspectGridAlignment: AUTO_BEHAVIOR_VALUES,
	watermarkSamplingCompat: AUTO_BEHAVIOR_VALUES,
	bgRemovalScope: {
		off: "Do not make anything transparent.",
		selected:
			"Only the region matching the picked colour; with 'rgb' extraction this behaves as 'outer'.",
		outer: "Only the background region connected to the image border.",
		auto: "Let the pipeline choose between outer and all from the background model.",
		all: "Every region matching the background colour, including enclosed ones.",
	} satisfies Record<BackgroundRemovalScope, string>,
	bgConnectivity: {
		"4": "Orthogonal neighbours only; safer against leaking through thin gaps.",
		"8": "Include diagonals; removes more background but can leak through one-pixel gaps.",
	} satisfies Record<Connectivity, string>,
	cellSamplingMode: {
		"legacy-median":
			"Per-channel median; the original behaviour, kept for reproducibility.",
		"hard-alpha-medoid":
			"Medoid over pixels above the alpha threshold; the default and the best anti-aliasing remover.",
		"alpha-aware-medoid":
			"Medoid weighted by alpha; keeps soft edges closer to the source.",
		"area-weighted":
			"Average weighted by coverage; keeps interpolated mid tones as partial alpha.",
		"edge-aware":
			"Favour the colour on the dominant side of an edge crossing the cell.",
	} satisfies Record<CellSamplingMode, string>,
	smallComponentMode: {
		off: "Keep every component.",
		light: "Remove only the smallest specks.",
		auto: "Choose the strength from the image size and background confidence.",
		strong:
			"Remove larger isolated components too; can eat small intentional details.",
	} satisfies Record<SmallComponentRemovalMode, string>,
	geminiWatermarkRemoval: {
		off: "Never remove the watermark.",
		auto: "Remove it when it matches the expected position, size and shape.",
	} satisfies Record<GeminiWatermarkRemovalMode, string>,
	ditherMode: {
		none: "No dithering.",
		"floyd-steinberg":
			"Error diffusion; smoothest gradients but adds scattered noise pixels.",
		"bayer-2x2": "Ordered 2x2 pattern; very coarse and highly regular.",
		"bayer-4x4": "Ordered 4x4 pattern; the usual retro look.",
		"bayer-8x8": "Ordered 8x8 pattern; finest ordered grain.",
		ordered: "Default ordered pattern.",
	} satisfies Record<DitherMode, string>,
	bgExtractionMethod: {
		none: "No background handling at all; also forces preRemoveBackground, postRemoveBackground and bgRemovalScope off.",
		auto: "Estimate the background colour from the image.",
		"top-left": "Take the background colour from the top-left pixel.",
		"bottom-left": "Take the background colour from the bottom-left pixel.",
		"top-right": "Take the background colour from the top-right pixel.",
		"bottom-right": "Take the background colour from the bottom-right pixel.",
		rgb: "Use the explicit colour given in bgRgb.",
	} satisfies Record<BgExtractionMethod, string>,
	outlineStyle: {
		none: "No outline.",
		rounded: "Outline with rounded corners.",
		sharp: "Outline with square corners.",
	} satisfies Record<OutlineStyle, string>,
	reduceColorMode: buildReduceColorModeDescriptions(),
};
