/**
 * The offline demo's SYNTHETIC taste model. Nothing here is Qloo data: films carry tags read from Wikipedia
 * and Wikidata (fixtures.ts), games carry hand-written tags, and an audience's affinity for a title is the
 * weighted overlap of their tags, squeezed into the narrow range real affinities fall in (about 0.75–0.97).
 * Demographics are made up from the tags too. It exists so the app runs end to end with no keys; its numbers
 * say nothing about real audiences.
 */
import { ANCHOR_GAMES, GAMES } from "../../../shared/games.ts";
import { AGE_BANDS, type AgeBand } from "../../explain/demographics.ts";
import { DEMO_FILMS, DEMO_TAGS } from "./fixtures.ts";

function fnv(text: string, seed: number): number {
	let h = (0x811c9dc5 ^ seed) >>> 0;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

const hex = (n: number) => n.toString(16).padStart(8, "0");

/** A stable pseudo-random number in [0, 1) for a string. */
export const noise = (text: string) => fnv(text, 7) / 2 ** 32;

/** Synthetic Qloo-style ID for a Wikidata QID. Its version digit is 0, so it can't be mistaken for a real Qloo ID. */
export function mockId(qid: string): string {
	const [a, b, c, d] = [1, 2, 3, 4].map((seed) => hex(fnv(`clearrun-demo:${qid}`, seed)));
	return `${a}-${b?.slice(0, 4)}-0${b?.slice(5, 8)}-8${c?.slice(1, 4)}-${c?.slice(4, 8)}${d}`.toUpperCase();
}

/** Tags for the curated games: the anchors and the proxies that stand in for unreleased games. */
const GAME_TAGS: Record<string, string[]> = {
	"Grand Theft Auto V": ["open world", "action", "crime", "adventure", "comedy", "thriller"],
	Minecraft: ["sandbox", "family", "adventure", "fantasy"],
	"The Sims 4": ["life simulation", "comedy", "family"],
	"Hogwarts Legacy": ["Harry Potter franchise", "fantasy", "adventure", "action", "teen"],
	"Stardew Valley": ["life simulation", "family", "fantasy"],
	"Call of Duty: Black Ops 6": ["shooter", "action", "war", "thriller", "spy"],
	"Red Dead Redemption 2": ["open world", "western", "action", "adventure", "crime", "drama"],
	"Animal Crossing: New Horizons": ["life simulation", "family", "comedy"],
	"Fable II": ["fantasy", "adventure", "action", "comedy"],
};

const byId = new Map<string, string[]>();
for (const g of [...ANCHOR_GAMES, ...GAMES.map((x) => x.proxy)]) if (GAME_TAGS[g.name]) byId.set(g.id.toUpperCase(), GAME_TAGS[g.name] as string[]);
for (const [qid, tags] of Object.entries(DEMO_TAGS)) byId.set(mockId(qid), tags);
for (const f of DEMO_FILMS) if (f.id && DEMO_TAGS[f.qid]) byId.set(f.id.toUpperCase(), DEMO_TAGS[f.qid] as string[]);

/** Tags of a synthetic film ID, a featured comp's Qloo ID, or a curated game. */
export const tagsOf = (id: string): string[] | undefined => byId.get(id.toUpperCase());

// Broad tags say little about taste; a shared franchise says a lot.
const BROAD: Record<string, number> = { drama: 0.4, comedy: 0.7, action: 0.8, adventure: 0.8, thriller: 0.8, epic: 0.6, teen: 0.8, fantasy: 0.9, mystery: 0.9, romance: 0.9 };
export const weightOf = (tag: string) => (tag.endsWith(" franchise") ? 3 : (BROAD[tag] ?? 1.3));

function vector(tags: string[]): Map<string, number> {
	const v = new Map(tags.map((t) => [t, weightOf(t)]));
	const norm = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
	for (const [t, x] of v) v.set(t, x / norm);
	return v;
}

/** Cosine similarity, 0–1, between an audience (the average of its comps' tag vectors) and a title. */
export function similarity(signal: string[][], tags: string[]): number {
	const audience = new Map<string, number>();
	for (const comp of signal) for (const [t, x] of vector(comp)) audience.set(t, (audience.get(t) ?? 0) + x / signal.length);
	const norm = Math.sqrt([...audience.values()].reduce((s, x) => s + x * x, 0)) || 1;
	let dot = 0;
	for (const [t, x] of vector(tags)) dot += ((audience.get(t) ?? 0) / norm) * x;
	return Math.max(0, Math.min(1, dot));
}

/** The synthetic affinity of an audience (comp IDs) for a title, or undefined when either side has no tags. */
export function affinity(signal: string[], id: string): number | undefined {
	const comps = signal.flatMap((s) => (tagsOf(s) ? [tagsOf(s) as string[]] : []));
	const tags = tagsOf(id);
	if (comps.length === 0 || !tags) return undefined;
	const jitter = (noise(`${[...signal].sort().join(",")}|${id.toUpperCase()}`) - 0.5) * 0.03;
	return Math.round(Math.max(0.55, Math.min(0.99, 0.72 + 0.25 * similarity(comps, tags) + jitter)) * 10_000) / 10_000;
}

// Made-up demographic leanings per tag: [24 and under, 25–29, 30–34, 35–44, 45–54, 55+] and a male lean.
const DEMO: Record<string, [number[], number]> = {
	animation: [[0.4, 0.05, 0.1, 0.3, -0.2, -0.4], -0.05],
	family: [[0.3, 0, 0.1, 0.35, -0.1, -0.35], -0.1],
	horror: [[0.4, 0.35, 0.15, -0.05, -0.25, -0.45], 0],
	superhero: [[0.25, 0.3, 0.25, 0.05, -0.2, -0.4], 0.3],
	"comic book": [[0.2, 0.25, 0.2, 0.05, -0.15, -0.3], 0.25],
	"science fiction": [[0.1, 0.25, 0.25, 0.1, -0.05, -0.2], 0.3],
	action: [[0.1, 0.2, 0.2, 0.1, 0, -0.15], 0.3],
	war: [[-0.2, -0.05, 0.05, 0.15, 0.25, 0.3], 0.35],
	western: [[-0.25, -0.1, 0, 0.15, 0.3, 0.4], 0.3],
	romance: [[0.15, 0.2, 0.1, 0, -0.05, 0], -0.4],
	musical: [[0.25, 0.15, 0.05, 0.05, -0.05, 0.05], -0.4],
	drama: [[-0.1, 0, 0.05, 0.1, 0.15, 0.2], -0.05],
	biographical: [[-0.15, -0.05, 0.05, 0.1, 0.2, 0.3], 0],
	historical: [[-0.2, -0.05, 0, 0.1, 0.25, 0.35], 0.1],
	teen: [[0.5, 0.2, -0.05, -0.1, -0.3, -0.45], -0.15],
	comedy: [[0.1, 0.15, 0.1, 0.05, 0, -0.1], 0],
	thriller: [[0, 0.1, 0.15, 0.15, 0.1, 0.05], 0.05],
	crime: [[-0.05, 0.1, 0.15, 0.15, 0.1, 0.05], 0.2],
	sports: [[0.05, 0.15, 0.15, 0.15, 0.05, -0.05], 0.4],
	fantasy: [[0.25, 0.2, 0.1, 0, -0.1, -0.25], -0.05],
	dystopian: [[0.35, 0.2, 0.05, -0.05, -0.2, -0.3], -0.1],
	"video game adaptation": [[0.45, 0.25, 0.05, -0.05, -0.3, -0.45], 0.35],
	holiday: [[0.05, 0, 0.05, 0.2, 0.1, 0.1], -0.25],
};

/** Synthetic age-band and gender indexes for a title, or undefined when it has no tags that lean either way. */
export function demographicsOf(id: string): { age: Record<AgeBand, number>; male: number } | undefined {
	const rows = (tagsOf(id) ?? []).flatMap((t) => (DEMO[t] ? [DEMO[t] as [number[], number]] : []));
	if (rows.length === 0) return undefined;
	const clamp = (x: number) => Math.round(Math.max(-0.6, Math.min(0.6, x)) * 100) / 100;
	const age = Object.fromEntries(AGE_BANDS.map((k, i) => [k, clamp(rows.reduce((s, r) => s + (r[0][i] ?? 0), 0) / rows.length)])) as Record<AgeBand, number>;
	return { age, male: clamp(rows.reduce((s, r) => s + r[1], 0) / rows.length) };
}
