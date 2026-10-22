/**
 * Curated game tentpoles in the slate window (CLEARRUN-PLAN §2.1). Unreleased games carry placeholder
 * dates and no scores in Qloo, so each one is scored through a released predecessor (its proxy), placed
 * among a fixed set of well-known anchor games. Each date is checked against the game's Wikipedia article.
 */
import type { QlooRef } from "./types.ts";

export interface GameTentpole {
	title: string;
	page: string;
	/** US launch date (YYYY-MM-DD) from the game's Wikipedia infobox. */
	date: string;
	source: string;
	checked: string;
	proxy: QlooRef;
}

export const GAMES: GameTentpole[] = [
	{
		title: "Grand Theft Auto VI",
		page: "Grand Theft Auto VI",
		date: "2026-11-19",
		source: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI",
		checked: "2026-10-21",
		proxy: { id: "FEFD4E0D-D8F2-4BF9-86C9-06949DE82BCD", name: "Grand Theft Auto V" },
	},
	{
		title: "Fable",
		page: "Fable (2027 video game)",
		date: "2027-02-23",
		source: "https://en.wikipedia.org/wiki/Fable_(2027_video_game)",
		checked: "2026-10-21",
		proxy: { id: "0378D07A-F5A6-49F9-BBA9-8CF6F7F44CCA", name: "Fable II" },
	},
];

/** Well-known released games. A proxy's overlap is its place among these, comparable to a film percentile. */
export const ANCHOR_GAMES: QlooRef[] = [
	{ id: "FEFD4E0D-D8F2-4BF9-86C9-06949DE82BCD", name: "Grand Theft Auto V" },
	{ id: "CDBDE254-71F0-4640-8D04-5373BEAE5278", name: "Minecraft" },
	{ id: "2225FC45-A2BE-454C-8527-6EAF3F4BF3DB", name: "The Sims 4" },
	{ id: "F51340DD-D451-4B77-BD9A-9FD2C0272AC1", name: "Hogwarts Legacy" },
	{ id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley" },
	{ id: "A75C78DD-1A64-4DA5-82E3-1367E0D7074B", name: "Call of Duty: Black Ops 6" },
	{ id: "0ED6691B-1F06-46D7-8F17-DB18826A5D0F", name: "Red Dead Redemption 2" },
	{ id: "08663BD2-E267-4C7F-9895-86410F67867C", name: "Animal Crossing: New Horizons" },
];
