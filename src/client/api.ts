import { useEffect, useState } from "react";
import type { Comparison } from "../engine/explain/compare.ts";
import type { AudienceProfile } from "../engine/explain/demographics.ts";
import type { AgentStepResponse, Comp, PlanProgress, PlanRequest, PlanResponse, PlanResult } from "../shared/types.ts";

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

/** Taste tags the comps share with a rival (or a game's proxy). */
export async function fetchExplain(comps: string[], rival: string, signal?: AbortSignal): Promise<Comparison> {
	const response = await fetch(`/api/explain?comps=${encodeURIComponent(comps.join(","))}&rival=${encodeURIComponent(rival)}`, { signal });
	if (!response.ok) throw new Error(await errorMessage(response));
	return (await response.json()) as Comparison;
}

export async function fetchAudience(comps: string[], signal?: AbortSignal): Promise<AudienceProfile | null> {
	const response = await fetch(`/api/audience?comps=${encodeURIComponent(comps.join(","))}`, { signal });
	if (!response.ok) throw new Error(await errorMessage(response));
	return ((await response.json()) as { profile: AudienceProfile | null }).profile;
}

export async function agentStep(body: { question: string } | { runId: string; after: number }, signal?: AbortSignal): Promise<AgentStepResponse> {
	const response = await fetch("/api/agent/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
	if (!response.ok) throw new Error(await errorMessage(response));
	return (await response.json()) as AgentStepResponse;
}

export async function fetchAgentRun(id: string, signal?: AbortSignal): Promise<AgentStepResponse> {
	const response = await fetch(`/api/agent/run?id=${encodeURIComponent(id)}`, { signal });
	if (!response.ok) throw new Error(response.status === 404 ? "That agent run has expired." : await errorMessage(response));
	return (await response.json()) as AgentStepResponse;
}
