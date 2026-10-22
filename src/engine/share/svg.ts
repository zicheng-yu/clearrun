/**
 * Share cards as 1200×630 SVG, in the site's look: the dark house, a row of marquee bulbs, Bebas Neue headlines and the
 * pressure strip. The Worker rasterizes them (src/worker/og). Text is fitted with the fonts' metrics; nothing here measures
 * rendered output.
 */
import type { BacktestCard, Card, CardStat, PlanCard } from "./card.ts";
import { FONT_METRICS, type CardFont } from "./metrics.ts";
import { ellipsize, escapeXml, fitSize, textWidth, wrap } from "./text.ts";
import { fmtDay } from "../score/narrate.ts";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const X = 64;
const RIGHT = CARD_WIDTH - X;
const WIDTH = RIGHT - X;

const C = {
	house: "#0e0e11",
	line: "#2a2a31",
	ink: "#f4f1ea",
	ink2: "#c9c4b9",
	muted: "#9a958b",
	marquee: "#f2b632",
	clear: "#57d6a4",
	hot: "#ff6a4d",
};

const TONE: Record<CardStat["tone"], string> = { hot: C.hot, marquee: C.marquee, clear: C.clear, ink: C.ink };

interface TextOptions {
	anchor?: "start" | "middle" | "end";
	spacing?: number;
	opacity?: number;
}

function text(x: number, y: number, content: string, font: CardFont, size: number, fill: string, o: TextOptions = {}): string {
	const f = FONT_METRICS[font];
	return `<text x="${r(x)}" y="${r(y)}" font-family="${f.family}" font-weight="${f.weight}" font-size="${r(size)}" fill="${fill}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ""}>${escapeXml(content)}</text>`;
}

const r = (n: number) => Math.round(n * 10) / 10;
const caps = (s: string) => s.toUpperCase();

/** The bulbs along the top edge, the mark and name, the context pill, and the footer every card shares. */
function frame(body: string, context: string | undefined, source: string): string {
	const bulbs = Array.from({ length: Math.ceil(CARD_WIDTH / 22) }, (_, i) => {
		const cx = 11 + i * 22;
		return `<circle cx="${cx}" cy="10" r="6" fill="${C.marquee}" opacity="0.18"/><circle cx="${cx}" cy="10" r="2.6" fill="#f9dc9a"/>`;
	}).join("");
	// The site's mark: a run of crowded weeks with one short, lit bar.
	const mark = (
		[
			[0, 16, C.hot, 0.45],
			[5.2, 20, C.hot, 0.7],
			[10.4, 6, C.marquee, 1],
			[15.6, 18, C.hot, 0.7],
			[20.8, 12, C.hot, 0.45],
			[26, 22, C.hot, 1],
		] as const
	)
		.map(([x, h, fill, o]) => `<rect x="${x}" y="${22 - h}" width="4" height="${h}" rx="1" fill="${fill}" opacity="${o}"/>`)
		.join("");
	let pill = "";
	if (context) {
		const label = caps(context);
		const w = textWidth(label, "mono", 15, 2) + 30;
		pill = `<rect x="${r(RIGHT - w)}" y="45" width="${r(w)}" height="32" rx="16" fill="${C.marquee}" fill-opacity="0.1" stroke="${C.marquee}" stroke-opacity="0.55"/>${text(RIGHT - w / 2 + 1, 66, label, "mono", 15, C.marquee, { anchor: "middle", spacing: 2 })}`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<defs><filter id="soft" x="-200%" y="-30%" width="500%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>${["marquee", "clear"]
		.map(
			(tone) =>
				`<radialGradient id="light-${tone}"><stop offset="0" stop-color="${C[tone as "marquee" | "clear"]}" stop-opacity="0.2"/><stop offset="0.55" stop-color="${C[tone as "marquee" | "clear"]}" stop-opacity="0.07"/><stop offset="1" stop-color="${C[tone as "marquee" | "clear"]}" stop-opacity="0"/></radialGradient>`,
		)
		.join("")}</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${C.house}"/>
<rect width="${CARD_WIDTH}" height="20" fill="${C.marquee}" fill-opacity="0.05"/>${bulbs}<rect y="20" width="${CARD_WIDTH}" height="1" fill="${C.line}"/>
<g transform="translate(${X},47) scale(1.35)">${mark}</g>${text(X + 52, 76, "CLEAR RUN", "display", 36, C.ink, { spacing: 2.2 })}${pill}
${body}
<rect x="${X}" y="575" width="${WIDTH}" height="1" fill="${C.line}"/>${text(X, 608, "clearrun.zichengyu.com", "textBold", 19, C.ink)}${text(RIGHT, 608, ellipsize(source, "text", 16, WIDTH - 280), "text", 16, C.muted, { anchor: "end" })}
</svg>`;
}

/**
 * A headline in Bebas Neue, lit like the marquee by a soft light behind it. The light is one radial gradient: a blurred copy of
 * the text looks much the same and takes three times as long to render.
 */
function headline(lines: string[], size: number, y: number, lineHeight: number, fill: string, light?: "marquee" | "clear"): string {
	const width = Math.max(...lines.map((line) => textWidth(line, "display", size)));
	const top = y - size * 0.72;
	const bottom = y + (lines.length - 1) * lineHeight;
	const glow = light
		? `<ellipse cx="${r(X + width / 2)}" cy="${r((top + bottom) / 2)}" rx="${r(width / 2 + 90)}" ry="${r((bottom - top) / 2 + 70)}" fill="url(#light-${light})"/>`
		: "";
	return glow + lines.map((line, i) => text(X - 3, y + i * lineHeight, line, "display", size, fill)).join("");
}

/** A note that fits: the whole note, else without its parenthetical, else cut with an ellipsis. */
function fitNote(note: string, font: CardFont, size: number, width: number): string {
	if (textWidth(note, font, size) <= width) return note;
	const short = note.replace(/\s*\([^)]*\)\s*$/, "");
	return ellipsize(short, font, size, width);
}

function stat(s: CardStat, x: number, y: number, width: number): string {
	const value = String(s.value);
	const valueWidth = textWidth(value, "mono", 50);
	return [
		text(x, y, ellipsize(caps(s.label), "mono", 14, width, 1.6), "mono", 14, C.muted, { spacing: 1.6 }),
		text(x - 2, y + 50, value, "mono", 50, TONE[s.tone]),
		text(x + valueWidth + 5, y + 50, "/ 100", "mono", 20, C.muted),
		text(x, y + 76, fitNote(s.note, "text", 17, width), "text", 17, C.ink2),
	].join("");
}

const heat = (p: number) => (p >= 0.5 ? 1 : p >= 0.3 ? 0.65 : p >= 0.15 ? 0.45 : 0.3);

/** The pressure calendar in miniature: a bar per opening week, your week capped, the recommended week lit. */
function strip(card: PlanCard, x: number, width: number): string {
	const n = card.strip.length;
	if (n === 0) return "";
	const slot = width / n;
	const bar = Math.min(20, slot * 0.62);
	const base = 532;
	const tall = 128;
	const out: string[] = [text(x, 364, "PRESSURE BY OPENING WEEK", "mono", 14, C.muted, { spacing: 1.6 })];
	const labels: { cx: number; top: number; label: string; fill: string }[] = [];
	card.strip.forEach((w, i) => {
		const cx = x + slot * (i + 0.5);
		const h = Math.max(3, w.p * tall);
		const fade = w.faded ? 0.35 : 1;
		if (w.focus) {
			out.push(`<rect x="${r(cx - bar / 2)}" y="${r(base - h)}" width="${r(bar)}" height="${r(h)}" rx="3" fill="${C.marquee}" opacity="0.7" filter="url(#soft)"/>`);
			out.push(`<rect x="${r(cx - bar / 2)}" y="${r(base - h)}" width="${r(bar)}" height="${r(h)}" rx="3" fill="${C.marquee}"/>`);
		} else {
			out.push(`<rect x="${r(cx - bar / 2)}" y="${r(base - h)}" width="${r(bar)}" height="${r(h)}" rx="3" fill="${C.hot}" opacity="${r(heat(w.p) * fade * 100) / 100}"/>`);
		}
		if (w.you) out.push(`<rect x="${r(cx - bar / 2 - 3)}" y="${r(base - h - 9)}" width="${r(bar + 6)}" height="4" rx="2" fill="${C.ink}"/>`);
		if (w.you || w.focus) {
			labels.push({ cx, top: base - h - (w.you ? 16 : 9), label: caps(fmtDay(w.week)), fill: w.focus ? (card.tone === "hold" ? C.clear : C.marquee) : C.ink });
		}
	});
	// Date labels above the marked bars; a second label that would collide moves up a line.
	labels.sort((a, b) => a.cx - b.cx);
	labels.forEach((l, i) => {
		const prev = labels[i - 1];
		const lift = prev && l.cx - prev.cx < 58 ? 18 : 0;
		const cx = Math.min(x + width - 26, Math.max(x + 26, l.cx));
		out.push(text(cx, Math.max(384, l.top - 6 - lift), l.label, "mono", 15, l.fill, { anchor: "middle", spacing: 0.5 }));
	});
	out.push(`<rect x="${r(x)}" y="${base + 4}" width="${r(width)}" height="1" fill="${C.line}"/>`);
	// Month labels under the first week of each month that has room for them.
	let lastEnd = -Infinity;
	card.strip.forEach((w, i) => {
		const prev = card.strip[i - 1];
		if (prev && prev.week.slice(5, 7) === w.week.slice(5, 7)) return;
		const label = caps(fmtDay(w.week, { month: "short" })) + (w.week.slice(5, 7) === "01" ? ` ${w.week.slice(0, 4)}` : "");
		const lx = x + slot * i + 2;
		if (lx < lastEnd + 10) return;
		out.push(text(lx, base + 26, label, "mono", 13, C.muted, { spacing: 1.2 }));
		lastEnd = lx + textWidth(label, "mono", 13, 1.2);
	});
	return out.join("");
}

function planSvg(card: PlanCard): string {
	const eyebrowText = caps(`${card.title ? `${card.title} · ` : ""}fans of ${card.comps.join(" + ")}`);
	const eyebrowSize = fitSize(eyebrowText, "mono", WIDTH, 19, 14, 1.8);
	const head = caps(card.headline);
	const headSize = fitSize(head, "display", WIDTH + 6, 158, 92);
	const fill = card.tone === "hold" ? C.clear : card.tone === "none" ? C.ink : C.marquee;
	const body = [
		text(X, 140, ellipsize(eyebrowText, "mono", eyebrowSize, WIDTH, 1.8), "mono", eyebrowSize, C.marquee, { spacing: 1.8 }),
		headline([head], headSize, 270, 0, fill, card.tone === "none" ? undefined : card.tone === "hold" ? "clear" : "marquee"),
		text(X, 314, ellipsize(card.sub, "mono", 20, WIDTH), "mono", 20, C.ink2),
		...card.stats.slice(0, 2).map((s, i) => stat(s, X, 362 + i * 114, 380)),
		strip(card, 486, RIGHT - 486),
	].join("\n");
	return frame(body, card.context, card.demo ? "Offline demo · synthetic scores, not Qloo data" : "Live US release calendar · Dates: Wikipedia · Taste data: Qloo");
}

function backtestSvg(card: BacktestCard): string {
	const lines = wrap("What the taste data knew before release", "display", 104, WIDTH, 2).map(caps);
	const trackX = 560;
	const trackW = 360;
	const rows = card.rows.slice(0, 6).map((row, i) => {
		const y = 404 + i * 31;
		const at = (o: number) => trackX + o * trackW;
		const pre = at(row.pre.overlap);
		const today = row.today ? at(row.today.overlap) : undefined;
		return [
			text(X, y, ellipsize(`${row.audience} fans → ${row.rival}`, "text", 18, trackX - X - 30), "text", 18, C.ink),
			`<rect x="${trackX}" y="${y - 7}" width="${trackW}" height="3" rx="1.5" fill="${C.line}"/>`,
			today !== undefined ? `<rect x="${r(Math.min(pre, today))}" y="${y - 7}" width="${r(Math.abs(today - pre))}" height="3" fill="${C.marquee}" opacity="0.45"/>` : "",
			`<circle cx="${r(pre)}" cy="${y - 5.5}" r="6.5" fill="${C.house}" stroke="${C.ink2}" stroke-width="2.5"/>`,
			today !== undefined ? `<circle cx="${r(today)}" cy="${y - 5.5}" r="7" fill="${C.marquee}"/>` : "",
			text(RIGHT, y, `#${row.pre.rank} → ${row.today ? `#${row.today.rank}` : "–"} of ${row.pre.of}`, "mono", 17, C.ink2, { anchor: "end" }),
		].join("");
	});
	const legend = [
		text(X, 368, "AUDIENCE → RIVAL", "mono", 13, C.muted, { spacing: 1.4 }),
		`<circle cx="${trackX + 6}" cy="363" r="5.5" fill="${C.house}" stroke="${C.ink2}" stroke-width="2.2"/>`,
		text(trackX + 18, 368, "BEFORE RELEASE", "mono", 13, C.muted, { spacing: 1.4 }),
		`<circle cx="${trackX + 176}" cy="363" r="6" fill="${C.marquee}"/>`,
		text(trackX + 188, 368, "TODAY", "mono", 13, C.muted, { spacing: 1.4 }),
		text(RIGHT, 368, "RANK BEFORE → TODAY", "mono", 13, C.muted, { anchor: "end", spacing: 1.4 }),
	].join("");
	const body = [
		text(X, 140, "THREE SAME-DAY OPENINGS, RE-PLANNED EIGHT WEEKS OUT", "mono", 19, C.marquee, { spacing: 1.8 }),
		headline(lines, 104, 236, 92, C.marquee, "marquee"),
		legend,
		...rows,
	].join("\n");
	return frame(body, "Backtests", card.demo ? "Offline demo · synthetic scores, not Qloo data" : "Content-based scores vs. Qloo's graph today · Dates: Wikipedia");
}

function homeSvg(): string {
	const lines = wrap("Find the week your audience is free", "display", 124, WIDTH, 2).map(caps);
	const sub = wrap(
		"The live US release calendar, scored against your audience with Qloo's taste graph: clear weeks, danger weeks, and an agent that re-plans when rivals move.",
		"text",
		23,
		WIDTH - 40,
		2,
	);
	// An illustration, not data: a run of busy weeks with one clear week lit, like the mark, labeled above the bars.
	const n = 40;
	const slot = WIDTH / n;
	const base = 556;
	const bars = Array.from({ length: n }, (_, i) => {
		const h = 16 + 46 * Math.abs(Math.sin(i * 1.9 + 0.6) * Math.cos(i * 0.47));
		const cx = X + slot * (i + 0.5);
		if (i !== 27) return `<rect x="${r(cx - 8)}" y="${r(base - h)}" width="16" height="${r(h)}" rx="3" fill="${C.hot}" opacity="${heat(h / 62)}"/>`;
		return [
			`<rect x="${r(cx - 8)}" y="${base - 12}" width="16" height="12" rx="3" fill="${C.marquee}" filter="url(#soft)"/>`,
			`<rect x="${r(cx - 8)}" y="${base - 12}" width="16" height="12" rx="3" fill="${C.marquee}"/>`,
			`<rect x="${r(cx - 0.75)}" y="${base - 74}" width="1.5" height="56" fill="${C.marquee}" opacity="0.8"/>`,
			text(cx, base - 80, "CLEAR WEEK", "mono", 14, C.marquee, { anchor: "middle", spacing: 1.4 }),
		].join("");
	}).join("");
	const body = [
		text(X, 146, "A RELEASE-PLANNING AGENT ON QLOO'S TASTE GRAPH", "mono", 19, C.marquee, { spacing: 1.8 }),
		headline(lines, 124, 256, 106, C.marquee, "marquee"),
		...sub.map((line, i) => text(X, 404 + i * 31, line, "text", 23, C.ink2)),
		bars,
	].join("\n");
	return frame(body, "Qloo Agentic Hackathon", "Release dates: Wikipedia · Taste data: Qloo");
}

export function cardSvg(card: Card): string {
	switch (card.kind) {
		case "plan":
			return planSvg(card);
		case "backtests":
			return backtestSvg(card);
		default:
			return homeSvg();
	}
}
