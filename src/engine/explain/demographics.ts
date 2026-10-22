/**
 * Your audience's demographics from Qloo (`filter.type=urn:demographics`): age-band and gender indexes
 * per comp, relative to the general population (positive = over-indexes). Released titles only, which
 * is why the audience is described by released comps.
 */

export const AGE_BANDS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_LABELS: Record<AgeBand, string> = {
	"24_and_younger": "24 and under",
	"25_to_29": "25–29",
	"30_to_34": "30–34",
	"35_to_44": "35–44",
	"45_to_54": "45–54",
	"55_and_older": "55+",
};

export interface AudienceProfile {
	/** Comps with demographic data (the profile averages them). */
	comps: number;
	age: Record<AgeBand, number>;
	/** Male index; the female index is its negative. */
	male: number;
	summary: string;
}

interface RawDemographics {
	results?: { demographics?: { query?: { age?: Partial<Record<AgeBand, number>>; gender?: { male?: number } } }[] };
}

const BAND_RANGE: Record<AgeBand, [number | undefined, number | undefined]> = {
	"24_and_younger": [undefined, 24],
	"25_to_29": [25, 29],
	"30_to_34": [30, 34],
	"35_to_44": [35, 44],
	"45_to_54": [45, 54],
	"55_and_older": [55, undefined],
};

/** "under 35", "25–34", "45+" for a run of adjacent bands. */
function spanLabel(first: AgeBand, last: AgeBand): string {
	const lo = BAND_RANGE[first][0];
	const hi = BAND_RANGE[last][1];
	if (lo === undefined && hi === undefined) return "all ages";
	if (lo === undefined) return `under ${(hi ?? 0) + 1}`;
	if (hi === undefined) return `${lo}+`;
	return `${lo}–${hi}`;
}

/** "Skews under 35, leans male": runs of over-indexed age bands (≥ 0.15) and a gender lean (|index| ≥ 0.1). */
export function describeProfile(age: Record<AgeBand, number>, male: number): string {
	const runs: AgeBand[][] = [];
	AGE_BANDS.forEach((band, i) => {
		if (age[band] < 0.15) return;
		const run = runs.at(-1);
		const prev = run?.at(-1);
		if (run && prev && AGE_BANDS.indexOf(prev) === i - 1) run.push(band);
		else runs.push([band]);
	});
	const spans = runs.map((run) => spanLabel(run[0] as AgeBand, run.at(-1) as AgeBand));
	const ages = spans.length === 0 ? "no strong age skew" : `skews ${spans.join(" and ")}`;
	const gender = male >= 0.1 ? "leans male" : male <= -0.1 ? "leans female" : "gender-balanced";
	const text = `${ages}, ${gender}`;
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function reduceDemographics(raw: RawDemographics): AudienceProfile | undefined {
	const rows = (raw.results?.demographics ?? []).filter((d) => d.query?.age);
	if (rows.length === 0) return undefined;
	const age = Object.fromEntries(AGE_BANDS.map((b) => [b, rows.reduce((sum, d) => sum + (d.query?.age?.[b] ?? 0), 0) / rows.length])) as Record<AgeBand, number>;
	const male = rows.reduce((sum, d) => sum + (d.query?.gender?.male ?? 0), 0) / rows.length;
	const round = (x: number) => Math.round(x * 100) / 100;
	for (const b of AGE_BANDS) age[b] = round(age[b]);
	return { comps: rows.length, age, male: round(male), summary: describeProfile(age, male) };
}
