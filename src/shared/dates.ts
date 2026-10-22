/** Date helpers on YYYY-MM-DD strings, all in UTC. */

export function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return isoDay(d);
}

/**
 * The Friday that starts the release week a title opens into. Wide releases open on Fridays;
 * Wednesday and Thursday openings (holidays, previews) belong to the coming Friday's weekend.
 */
export function releaseWeek(day: string): string {
	const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday … 5 = Friday
	const offset = [-2, -3, -4, 2, 1, 0, -1][dow] ?? 0;
	return addDays(day, offset);
}
