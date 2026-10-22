/** Rival explanations and audience profiles from Qloo, cached for 7 days per (audience, rival). */
import { reduceCompare, type Comparison } from "../engine/explain/compare.ts";
import { reduceDemographics, type AudienceProfile } from "../engine/explain/demographics.ts";
import type { QlooClient } from "./qloo.ts";

/** Taste tags your comps share with a rival (or with a game's proxy), and tags only one side has. */
export function compareWithRival(qloo: QlooClient, comps: string[], rival: string): Promise<Comparison> {
	return qloo.get(
		"/v2/analysis/compare",
		{ "a.signal.interests.entities": comps.join(","), "b.signal.interests.entities": rival },
		{ reduce: (body) => reduceCompare(JSON.parse(body)) },
	);
}

/** Age and gender indexes of the comps' fans, averaged across comps; null when Qloo has none. */
export function audienceOf(qloo: QlooClient, comps: string[]): Promise<AudienceProfile | null> {
	return qloo.get(
		"/v2/insights",
		{ "filter.type": "urn:demographics", "signal.interests.entities": comps.join(",") },
		{ reduce: (body) => reduceDemographics(JSON.parse(body)) ?? null },
	);
}
