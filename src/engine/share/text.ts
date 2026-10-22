/** Text layout for the share cards: widths from the fonts' metrics, shrink-to-fit, ellipsis and word wrap. SVG has none of these. */
import { FONT_METRICS, type CardFont } from "./metrics.ts";

const tables = new Map<CardFont, Map<number, number>>();

function widths(font: CardFont): Map<number, number> {
	let table = tables.get(font);
	if (!table) {
		table = new Map();
		for (const [start, list] of FONT_METRICS[font].ranges) list.forEach((w, i) => w > 0 && table?.set(start + i, w));
		tables.set(font, table);
	}
	return table;
}

/** Width in pixels. A character the font lacks is drawn from a fallback font, so it's measured in Inter. */
export function textWidth(text: string, font: CardFont, size: number, spacing = 0): number {
	const own = widths(font);
	let units = 0;
	let count = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 32;
		units += own.get(cp) ?? widths("text").get(cp) ?? 600;
		count += 1;
	}
	return (units / 1000) * size + spacing * count;
}

/** The largest size from `max` down to `min` at which the text fits `maxWidth`. */
export function fitSize(text: string, font: CardFont, maxWidth: number, max: number, min: number, spacing = 0): number {
	const atMax = textWidth(text, font, max, spacing);
	if (atMax <= maxWidth) return max;
	const scaled = Math.floor((max * (maxWidth - spacing * [...text].length)) / (atMax - spacing * [...text].length));
	return Math.max(min, Math.min(max, scaled));
}

/** The text, cut at a word boundary where possible and ended with an ellipsis, so it fits `maxWidth`. */
export function ellipsize(text: string, font: CardFont, size: number, maxWidth: number, spacing = 0): string {
	if (textWidth(text, font, size, spacing) <= maxWidth) return text;
	const chars = [...text];
	let cut = chars.length;
	while (cut > 0 && textWidth(`${chars.slice(0, cut).join("").trimEnd()}…`, font, size, spacing) > maxWidth) cut -= 1;
	const head = chars.slice(0, cut).join("");
	const space = head.lastIndexOf(" ");
	return `${(space > head.length * 0.6 ? head.slice(0, space) : head).trimEnd().replace(/[,;:·–—-]$/, "")}…`;
}

/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsized if text is left over. */
export function wrap(text: string, font: CardFont, size: number, maxWidth: number, maxLines: number, spacing = 0): string[] {
	const lines: string[] = [];
	let line = "";
	const words = text.split(/\s+/).filter(Boolean);
	for (let i = 0; i < words.length; i++) {
		const next = line ? `${line} ${words[i]}` : (words[i] ?? "");
		if (textWidth(next, font, size, spacing) <= maxWidth || !line) {
			line = next;
			continue;
		}
		lines.push(line);
		line = words[i] ?? "";
		if (lines.length === maxLines - 1) {
			lines.push(ellipsize(words.slice(i).join(" "), font, size, maxWidth, spacing));
			return lines;
		}
	}
	if (line) lines.push(ellipsize(line, font, size, maxWidth, spacing));
	return lines;
}

export const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
