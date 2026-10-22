/**
 * Checking a no-tools answer against the live slate: split the answer from the list of releases the model
 * says it relied on, match each title to the slate, and compare dates. Matching is strict on purpose, so a
 * wrong-date verdict always names the slate title it was compared with.
 */
import { releaseWeek } from "../../shared/dates.ts";
import type { CheckedClaim, ClaimStatus } from "../../shared/types.ts";
import { normalizeTitle, parseDay } from "../agent/text.ts";

export interface Claim {
	title: string;
	date: string | null;
}

export interface SlateEntry {
	title: string;
	date: string;
	/** Other names people use (e.g. "GTA VI"). */
	aliases?: string[];
}

export const CLAIM_STATUSES: ClaimStatus[] = ["right-date", "right-week", "wrong-date", "no-date", "not-on-slate", "outside-window"];

/**
 * The answer text, and the JSON in the last ```json block (or a trailing bare array): either a list of
 * releases, or {recommended, releases} with the date the model recommends.
 */
export function splitAnswer(text: string): { answer: string; claims?: Claim[]; recommended?: string } {
	const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
	const last = fences.at(-1);
	let json: string | undefined;
	let answer = text;
	if (last && last.index !== undefined) {
		json = last[1];
		answer = text.slice(0, last.index);
	} else {
		const start = text.lastIndexOf("\n[");
		if (start >= 0 && text.trimEnd().endsWith("]")) {
			json = text.slice(start + 1);
			answer = text.slice(0, start);
		}
	}
	answer = answer.replace(/\n\s*(?:Releases|Sources|JSON)[^\n]*:\s*$/i, "").trim();
	if (json === undefined) return { answer };
	try {
		const parsed = JSON.parse(json.trim()) as unknown;
		const wrapped = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { recommended?: unknown; releases?: unknown }) : undefined;
		const list = wrapped ? wrapped.releases : parsed;
		const recommended = typeof wrapped?.recommended === "string" && wrapped.recommended.trim() ? wrapped.recommended.trim().slice(0, 40) : undefined;
		if (!Array.isArray(list)) return { answer, ...(recommended ? { recommended } : {}) };
		const claims = list.flatMap((item): Claim[] => {
			if (!item || typeof item !== "object") return [];
			const { title, date } = item as { title?: unknown; date?: unknown };
			if (typeof title !== "string" || !title.trim()) return [];
			return [{ title: title.trim().slice(0, 120), date: typeof date === "string" && date.trim() ? date.trim().slice(0, 40) : null }];
		});
		return { answer, claims, ...(recommended ? { recommended } : {}) };
	} catch {
		return { answer };
	}
}

/** Title key: lowercased, accents and punctuation stripped, "(2026)" and a leading "the" removed. */
export const titleKey = (title: string) =>
	normalizeTitle(title.replace(/\(\s*\d{4}\s*(?:film)?\s*\)/gi, ""))
		.replace(/^the /, "")
		.trim();

const words = (key: string) => (key ? key.split(" ").length : 0);
const before = (title: string) => (title.includes(":") ? titleKey(title.slice(0, title.indexOf(":"))) : "");
const after = (title: string) => (title.includes(":") ? titleKey(title.slice(title.indexOf(":") + 1)) : "");

/**
 * Slate entries a claimed title refers to: the same title or alias; the franchise before a colon when it
 * names one slate title ("Narnia"); the subtitle after a colon ("Sunrise on the Reaping"); or one title
 * containing the other when the shorter has at least three words.
 */
export function findOnSlate<T extends SlateEntry>(claimed: string, slate: T[]): T[] {
	const k = titleKey(claimed);
	if (!k) return [];
	const exact = slate.filter((t) => titleKey(t.title) === k || (t.aliases ?? []).some((a) => titleKey(a) === k));
	if (exact.length) return exact;
	const franchise = slate.filter((t) => before(t.title) === k);
	if (franchise.length && new Set(franchise.map((t) => t.title)).size === 1) return franchise;
	const subtitle = slate.filter((t) => words(after(t.title)) >= 2 && after(t.title) === k);
	if (subtitle.length) return subtitle;
	const contained = slate.filter((t) => {
		const s = titleKey(t.title);
		const [short, long] = s.length < k.length ? [s, k] : [k, s];
		return words(short) >= 3 && ` ${long} `.includes(` ${short} `);
	});
	return new Set(contained.map((t) => t.title)).size === 1 ? contained : [];
}

/** Whether an answer mentions a title: by name, alias, subtitle (two words or more) or a distinctive franchise word. */
export function mentions(answer: string, entry: SlateEntry): boolean {
	const text = ` ${titleKey(answer)} `;
	const names = [entry.title, ...(entry.aliases ?? [])].map(titleKey);
	const sub = after(entry.title);
	const pre = before(entry.title);
	if (words(sub) >= 2) names.push(sub);
	if (pre.length >= 6) names.push(pre);
	return names.some((n) => n && text.includes(` ${n} `));
}

export interface ClaimCheck {
	claims: CheckedClaim[];
	counts: Record<ClaimStatus, number>;
	missed: { title: string; date: string }[];
	topChecked: number;
}

/**
 * Each claim against the slate: the right day, the right release week, a wrong date, no date, or a title
 * that isn't on the slate. A claim dated outside the slate window that doesn't match a slate title can't be
 * checked. `top` is the audience's biggest rivals; the ones the answer never mentions are returned as missed.
 */
export function checkClaims<T extends SlateEntry>(input: { claims: Claim[]; slate: T[]; window: { start: string; end: string }; answer: string; top?: T[] }): ClaimCheck {
	const counts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as Record<ClaimStatus, number>;
	const matched = new Set<string>();
	const claims = input.claims.map((c): CheckedClaim => {
		const said = c.date ? parseDay(c.date, input.window) : undefined;
		const hits = findOnSlate(c.title, input.slate);
		for (const h of hits) matched.add(h.title);
		// A film listed twice (limited, then wide) is right if either date matches.
		const sameDay = said ? hits.find((h) => h.date === said) : undefined;
		const sameWeek = said ? hits.find((h) => releaseWeek(h.date) === releaseWeek(said)) : undefined;
		const hit = sameDay ?? sameWeek ?? hits[0];
		let status: ClaimStatus;
		if (!hit) status = said && (said < input.window.start || said > input.window.end) ? "outside-window" : "not-on-slate";
		else if (!said) status = "no-date";
		else if (hit.date === said) status = "right-date";
		else if (releaseWeek(hit.date) === releaseWeek(said)) status = "right-week";
		else status = "wrong-date";
		counts[status] += 1;
		return { title: c.title, ...(said ? { said } : {}), ...(c.date && !said ? { saidText: c.date } : {}), status, ...(hit ? { slate: { title: hit.title, date: hit.date } } : {}) };
	});
	const top = input.top ?? [];
	const missed = top.filter((t) => !matched.has(t.title) && !mentions(input.answer, t)).map((t) => ({ title: t.title, date: t.date }));
	return { claims, counts, missed, topChecked: top.length };
}
