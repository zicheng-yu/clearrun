/**
 * Builds the fonts the share cards are drawn with. Run: node scripts/build-card-fonts.ts (rerun only to change fonts or characters).
 * - Downloads Bebas Neue, Inter (400 and 600) and JetBrains Mono (500) from Google Fonts as TrueType (its CSS API serves TTF to
 *   clients it doesn't recognize), subsets them to Latin, and writes them to src/worker/og/fonts/*.bin with their licenses
 *   (SIL Open Font License 1.1; none of the three reserves its font name, so subsets may keep it).
 * - Writes src/engine/share/metrics.ts: each font's advance widths, so the card templates can fit and wrap text without a renderer.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import subsetFont from "subset-font";

const OUT = "src/worker/og/fonts";

const FONTS = [
	{ key: "display", file: "BebasNeue-Regular", css: "Bebas+Neue", family: "Bebas Neue", weight: 400, ofl: "bebasneue" },
	{ key: "text", file: "Inter-Regular", css: "Inter:wght@400", family: "Inter", weight: 400, ofl: "inter" },
	{ key: "textBold", file: "Inter-SemiBold", css: "Inter:wght@600", family: "Inter", weight: 600, ofl: "inter" },
	{ key: "mono", file: "JetBrainsMono-Medium", css: "JetBrains+Mono:wght@500", family: "JetBrains Mono", weight: 500, ofl: "jetbrainsmono" },
] as const;

// Printable ASCII, Latin-1, Latin Extended-A, general punctuation, arrows, the minus sign and the bullet.
const RANGES: [number, number][] = [
	[0x20, 0x7e],
	[0xa0, 0x17f],
	[0x2010, 0x2027],
	[0x2030, 0x203a],
	[0x2190, 0x2193],
	[0x2212, 0x2212],
];
const CODEPOINTS = RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));

async function download(url: string): Promise<Buffer> {
	// A bare user agent gets TrueType URLs from the CSS API (browsers get WOFF2, which the renderer can't read).
	const response = await fetch(url, { headers: { "User-Agent": "curl/8" } });
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

/** Units per em, ascent, descent and a codepoint → advance width lookup, read from the font's head, hhea, hmtx and cmap tables. */
function metricsOf(font: Buffer) {
	const tables = new Map<string, number>();
	for (let i = 0; i < font.readUInt16BE(4); i++) tables.set(font.toString("latin1", 12 + i * 16, 16 + i * 16), font.readUInt32BE(20 + i * 16));
	const at = (tag: string) => {
		const offset = tables.get(tag);
		if (offset === undefined) throw new Error(`no ${tag} table`);
		return offset;
	};
	const upm = font.readUInt16BE(at("head") + 18);
	const hhea = at("hhea");
	const metrics = font.readUInt16BE(hhea + 34);
	const advance = (glyph: number) => font.readUInt16BE(at("hmtx") + 4 * Math.min(glyph, metrics - 1));

	// The Unicode cmap subtable: format 12 (full range) or format 4 (BMP).
	const cmap = at("cmap");
	let glyphOf: ((cp: number) => number) | undefined;
	for (let i = 0; i < font.readUInt16BE(cmap + 2) && !glyphOf; i++) {
		const sub = cmap + font.readUInt32BE(cmap + 8 + i * 8);
		const format = font.readUInt16BE(sub);
		if (format === 12) {
			const groups = font.readUInt32BE(sub + 12);
			glyphOf = (cp) => {
				for (let g = 0; g < groups; g++) {
					const base = sub + 16 + g * 12;
					if (cp >= font.readUInt32BE(base) && cp <= font.readUInt32BE(base + 4)) return font.readUInt32BE(base + 8) + cp - font.readUInt32BE(base);
				}
				return 0;
			};
		} else if (format === 4) {
			const segments = font.readUInt16BE(sub + 6) / 2;
			const ends = sub + 14;
			const starts = ends + 2 + segments * 2;
			const deltas = starts + segments * 2;
			const offsets = deltas + segments * 2;
			glyphOf = (cp) => {
				for (let s = 0; s < segments; s++) {
					if (cp > font.readUInt16BE(ends + s * 2) || cp < font.readUInt16BE(starts + s * 2)) continue;
					const delta = font.readInt16BE(deltas + s * 2);
					const rangeOffset = font.readUInt16BE(offsets + s * 2);
					if (rangeOffset === 0) return (cp + delta) & 0xffff;
					const glyph = font.readUInt16BE(offsets + s * 2 + rangeOffset + 2 * (cp - font.readUInt16BE(starts + s * 2)));
					return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
				}
				return 0;
			};
		}
	}
	if (!glyphOf) throw new Error("no Unicode cmap");
	const lookup = glyphOf;
	return {
		ascent: font.readInt16BE(hhea + 4) / upm,
		descent: -font.readInt16BE(hhea + 6) / upm,
		// Advance in thousandths of an em; 0 when the font has no glyph for the character.
		width: (cp: number) => {
			const glyph = lookup(cp);
			return glyph === 0 ? 0 : Math.round((advance(glyph) / upm) * 1000);
		},
	};
}

mkdirSync(OUT, { recursive: true });
const text = String.fromCodePoint(...CODEPOINTS);
const entries: string[] = [];
for (const f of FONTS) {
	const css = (await download(`https://fonts.googleapis.com/css2?family=${f.css}`)).toString("utf8");
	const url = /url\((https:[^)]+\.ttf)\)/.exec(css)?.[1];
	if (!url) throw new Error(`No TrueType URL for ${f.family}`);
	const subset = Buffer.from(await subsetFont(await download(url), text, { targetFormat: "truetype" }));
	writeFileSync(`${OUT}/${f.file}.bin`, subset);
	writeFileSync(`${OUT}/OFL-${f.ofl}.txt`, await download(`https://raw.githubusercontent.com/google/fonts/main/ofl/${f.ofl}/OFL.txt`));
	const m = metricsOf(subset);
	const ranges = RANGES.map(([a, b]) => `[${a}, [${Array.from({ length: b - a + 1 }, (_, i) => m.width(a + i)).join(",")}]]`);
	entries.push(
		`\t${f.key}: { family: ${JSON.stringify(f.family)}, weight: ${f.weight}, ascent: ${m.ascent.toFixed(3)}, descent: ${m.descent.toFixed(3)}, ranges: [${ranges.join(", ")}] },`,
	);
	console.log(`${f.file}: ${subset.length} bytes, missing ${CODEPOINTS.filter((cp) => m.width(cp) === 0).length} of ${CODEPOINTS.length} characters`);
}

writeFileSync(
	"src/engine/share/metrics.ts",
	`/**
 * GENERATED by scripts/build-card-fonts.ts. Do not edit by hand.
 * The share-card fonts (subset TrueType files in src/worker/og/fonts) and their advance widths in thousandths of an em, by
 * Unicode range (0 = no glyph), so the card templates can fit and wrap text without a renderer. Kerning isn't counted, so
 * measured widths run slightly wide.
 */
export type CardFont = ${FONTS.map((f) => JSON.stringify(f.key)).join(" | ")};

export interface FontMetrics {
	family: string;
	weight: number;
	ascent: number;
	descent: number;
	ranges: [start: number, widths: number[]][];
}

export const FONT_METRICS: Record<CardFont, FontMetrics> = {
${entries.join("\n")}
};
`,
);
execFileSync("npx", ["prettier", "--use-tabs", "--print-width", "180", "--write", "src/engine/share/metrics.ts"], { stdio: "inherit" });
