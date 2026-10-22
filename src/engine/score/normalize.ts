/** Normalization for the pressure calendar: within-query percentiles and attention size. */

/** Percentile of each value among all values, 0 (lowest) to 1 (highest). Ties share their average rank. */
export function percentiles(values: Map<string, number>): Map<string, number> {
	const entries = [...values.entries()].sort((a, b) => a[1] - b[1]);
	const out = new Map<string, number>();
	const n = entries.length;
	for (let i = 0; i < n;) {
		let j = i;
		while (j + 1 < n && entries[j + 1][1] === entries[i][1]) j++;
		const p = n === 1 ? 1 : (i + j) / 2 / (n - 1);
		for (let k = i; k <= j; k++) out.set(entries[k][0], p);
		i = j + 1;
	}
	return out;
}

/** Where `value` sits among `others`, 0–1: the share of others below it (ties count half). */
export function placeAmong(value: number, others: number[]): number | undefined {
	if (others.length === 0) return undefined;
	let below = 0;
	for (const o of others) below += o < value ? 1 : o === value ? 0.5 : 0;
	return below / others.length;
}

/**
 * Attention size per title: the square root of its share of the biggest title's pageviews, floored so
 * every dated title counts a little. The square root (an assumption, shown in the UI) keeps a tentpole
 * well above a small release without letting it drown out everything else.
 */
export function sizes(views: Map<string, number | undefined>, floor = 0.05): Map<string, number> {
	const max = Math.max(0, ...[...views.values()].map((v) => v ?? 0));
	const out = new Map<string, number>();
	for (const [id, v] of views) out.set(id, max > 0 && v && v > 0 ? Math.max(floor, Math.sqrt(v / max)) : floor);
	return out;
}
