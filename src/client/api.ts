import { useEffect, useState } from "react";
import type { Comp, PlanProgress, PlanRequest, PlanResponse, PlanResult } from "../shared/types.ts";

async function errorMessage(response: Response): Promise<string> {
	const body = (await response.json().catch(() => ({}))) as { message?: string };
	if (response.status === 503 && !body.message) return "The release calendar is still being built. Check back in a few minutes.";
	return body.message ?? `Request failed (HTTP ${response.status})`;
}

export function useJson<T>(url: string): { data?: T; error?: string } {
	const [state, setState] = useState<{ data?: T; error?: string }>({});
	useEffect(() => {
		let live = true;
		fetch(url)
			.then(async (r) => (r.ok ? ((await r.json()) as T) : Promise.reject(new Error(await errorMessage(r)))))
			.then((data) => live && setState({ data }))
			.catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }));
		return () => {
			live = false;
		};
	}, [url]);
	return state;
}

/** Runs a plan to completion. Each request scores up to two batches; cached audiences finish in one. */
export async function runPlan(request: PlanRequest, onProgress: (progress: PlanProgress) => void, signal?: AbortSignal): Promise<PlanResult> {
	let calls = 0;
	for (let step = 0; step < 10; step++) {
		const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
		if (!response.ok) throw new Error(await errorMessage(response));
		const body = (await response.json()) as PlanResponse;
		calls += body.qlooCalls;
		if (body.status === "ready") return { ...body, qlooCalls: calls };
		onProgress({ ...body, qlooCalls: calls });
	}
	throw new Error("Scoring is taking longer than expected. Try again in a minute.");
}

export async function searchFilms(query: string, signal?: AbortSignal): Promise<Comp[]> {
	const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
	if (!response.ok) throw new Error(await errorMessage(response));
	return ((await response.json()) as { results: Comp[] }).results;
}
