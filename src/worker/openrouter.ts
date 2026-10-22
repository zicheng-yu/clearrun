/**
 * OpenRouter (OpenAI-compatible chat completions) with a hard spending guard. Every call checks the
 * D1 ledger first (daily and all-time caps) and records its exact cost afterwards (`usage.cost`).
 * Defaults are frugal: Claude Haiku 5.5, low reasoning effort, small max_tokens, and automatic prompt
 * caching (a top-level `cache_control`, so the system prompt and tools are read from cache after the
 * first call of a run).
 */
import { llmSpend, recordLlmSpend } from "./store.ts";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
/** USD per million tokens for the default model, used only if a response carries no cost. */
const FALLBACK_PRICE = { input: 0.1, output: 0.5 };

export interface LlmConfig {
	apiKey: string;
	model: string;
	fallbackModels: string[];
	maxTokens: number;
	dailyUsd: number;
	totalUsd: number;
	appUrl?: string;
}

export class BudgetExhaustedError extends Error {
	constructor() {
		super("The agent has reached its spending cap for now; the calendar and scores still work.");
		this.name = "BudgetExhaustedError";
	}
}

export class LlmError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "LlmError";
		this.status = status;
	}
}

export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

/** Assistant turns are replayed exactly as returned, including `reasoning_details`, which Claude needs across tool calls. */
export interface AssistantMessage {
	role: "assistant";
	content: string | null;
	tool_calls?: ToolCall[];
	reasoning_details?: unknown[];
}

export type ChatMessage = { role: "system"; content: string } | { role: "user"; content: string } | AssistantMessage | { role: "tool"; tool_call_id: string; content: string };

export interface ChatResult {
	message: AssistantMessage;
	finishReason?: string;
	model?: string;
	usage: { inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number };
}

export async function chat(
	db: D1Database,
	config: LlmConfig,
	request: { messages: ChatMessage[]; tools?: unknown[]; toolChoice?: "auto" | "none"; maxTokens?: number; sessionId?: string },
): Promise<ChatResult> {
	const spent = await llmSpend(db);
	if (spent.today >= config.dailyUsd || spent.total >= config.totalUsd) throw new BudgetExhaustedError();
	const response = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
			...(config.appUrl ? { "HTTP-Referer": config.appUrl, "X-Title": "Clear Run" } : {}),
		},
		body: JSON.stringify({
			model: config.model,
			models: [config.model, ...config.fallbackModels],
			messages: request.messages,
			...(request.tools ? { tools: request.tools, tool_choice: request.toolChoice ?? "auto" } : {}),
			max_tokens: Math.min(request.maxTokens ?? config.maxTokens, config.maxTokens),
			reasoning: { effort: "low" },
			cache_control: { type: "ephemeral" },
			...(request.sessionId ? { session_id: request.sessionId } : {}),
			usage: { include: true },
		}),
	});
	if (!response.ok) throw new LlmError(response.status, `OpenRouter ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`);
	const data = (await response.json()) as {
		choices?: { message?: Partial<AssistantMessage>; finish_reason?: string }[];
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			cost?: number;
			prompt_tokens_details?: { cached_tokens?: number };
			completion_tokens_details?: { reasoning_tokens?: number };
		};
		model?: string;
	};
	const inputTokens = data.usage?.prompt_tokens ?? 0;
	const outputTokens = data.usage?.completion_tokens ?? 0;
	const costUsd = typeof data.usage?.cost === "number" ? data.usage.cost : (inputTokens * FALLBACK_PRICE.input + outputTokens * FALLBACK_PRICE.output) / 1_000_000;
	await recordLlmSpend(db, costUsd, inputTokens + outputTokens);
	const raw = data.choices?.[0]?.message ?? {};
	return {
		message: {
			role: "assistant",
			content: raw.content ?? null,
			...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}),
			...(raw.reasoning_details?.length ? { reasoning_details: raw.reasoning_details } : {}),
		},
		finishReason: data.choices?.[0]?.finish_reason,
		model: data.model,
		usage: {
			inputTokens,
			cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
			outputTokens,
			reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
			costUsd,
		},
	};
}
