import type { SlateChange, SlateSnapshot, SlateTitle } from "../../shared/types.ts";

/** Date moves, new entrants and removals between two snapshots, limited to the overlapping window. */
export function diffSlates(before: SlateSnapshot, after: SlateSnapshot): SlateChange[] {
	const start = after.windowStart > before.windowStart ? after.windowStart : before.windowStart;
	const end = after.windowEnd < before.windowEnd ? after.windowEnd : before.windowEnd;
	const inWindow = (t: SlateTitle) => t.date >= start && t.date <= end;
	const prev = new Map(before.titles.map((t) => [t.id, t]));
	const next = new Map(after.titles.map((t) => [t.id, t]));
	const changes: SlateChange[] = [];
	for (const [id, t] of next) {
		const old = prev.get(id);
		if (!old) {
			if (inWindow(t)) changes.push({ kind: "added", id, title: t.title, to: t.date });
		} else if (old.date !== t.date) changes.push({ kind: "moved", id, title: t.title, from: old.date, to: t.date });
	}
	for (const [id, t] of prev) if (!next.has(id) && inWindow(t) && t.date >= after.windowStart) changes.push({ kind: "removed", id, title: t.title, from: t.date });
	return changes;
}
