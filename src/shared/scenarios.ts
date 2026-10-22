/** Featured scenarios: real titles on the live slate, each with released comps that describe its audience. */
import type { Comp } from "./types.ts";

export interface Scenario {
	id: string;
	name: string;
	question: string;
	comps: Comp[];
	/** Slate ID (Wikidata QID) of the title being planned, when it already has a date. */
	you?: string;
	/** Earliest release week to consider (YYYY-MM-DD); defaults to four weeks out. */
	from?: string;
}

export const SCENARIOS: Scenario[] = [
	{
		id: "dunesday",
		name: "Dunesday",
		question: "Dune: Part Three shares its opening day with Avengers: Doomsday. Hold the date or move?",
		comps: [
			{ id: "878A5D45-469C-4556-8494-963C2B1D3A95", name: "Dune: Part Two", year: 2024 },
			{ id: "3037F0E8-C912-4DC0-BDE3-1F94631F9DA6", name: "Dune", year: 2021 },
		],
		you: "Q124714245",
	},
	{
		id: "gta-week",
		name: "GTA VI week",
		question: "Grand Theft Auto VI launches the day before The Hunger Games: Sunrise on the Reaping. How exposed is the film?",
		comps: [
			{ id: "526DA082-8186-4149-95F9-DD14ED56AEA4", name: "The Hunger Games", year: 2012 },
			{ id: "ECFA2EC6-55FD-4CE7-ADA7-12A4A41B0A4A", name: "The Hunger Games: Catching Fire", year: 2013, short: "Catching Fire" },
			{ id: "0063BFEC-EB8C-458D-A0BF-D7028F5294F6", name: "The Hunger Games: The Ballad of Songbirds & Snakes", year: 2023, short: "The Ballad of Songbirds & Snakes" },
		],
		you: "Q126390739",
	},
	{
		id: "family",
		name: "Family slot",
		question: "A new family film for this winter. Which week is clear of the family pile-up?",
		comps: [
			{ id: "FD27AC52-4880-404E-BECF-E99DEDEAE2FC", name: "Paddington 2", year: 2017 },
			{ id: "D908E95E-3471-464F-9472-281639E731FF", name: "The Wild Robot", year: 2024 },
		],
	},
	{
		id: "horror",
		name: "Indie horror",
		question: "An original horror film for early 2027. Where is the quietest window for horror fans?",
		comps: [
			{ id: "17C8BCEF-2FF2-4A23-8F51-6C8CB9CD8114", name: "Hereditary", year: 2018 },
			{ id: "E26FA111-146B-47F1-BA1E-34414DF96C83", name: "Talk to Me", year: 2022 },
		],
		from: "2027-01-01",
	},
];
