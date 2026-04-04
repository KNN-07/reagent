/**
 * CompactionService — Context Management for ReAgent
 *
 * Monitors token budget during long research sessions (surveys, autopaper)
 * and triggers background summarization when approaching context limits.
 *
 * Inspired by Claude Code's context compaction architecture:
 * - Watches token usage events from the agent session
 * - Triggers compaction when usage > threshold (default: 80% of model context)
 * - Uses the 'smol' model role for summary generation (cheap + fast)
 * - Injects compact summary back as a context-preserved system message
 */

import * as path from "node:path";
import { completeSimple, Effort } from "@reagent/ra-ai";
import { logger } from "@reagent/ra-utils";
import type { AgentSession } from "@reagent/ra-coding-agent/session/agent-session";
import type { ModelRegistry } from "@reagent/ra-coding-agent/config/model-registry";

export interface CompactionConfig {
	/** Fraction of context window that triggers compaction. Default: 0.80 */
	threshold: number;
	/** Max tokens the compaction summary may consume. Default: 4096 */
	summaryMaxTokens: number;
	/** Minimum turns between compactions. Default: 10 */
	minTurnsBetweenCompactions: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
	threshold: 0.80,
	summaryMaxTokens: 4096,
	minTurnsBetweenCompactions: 10,
};

export interface CompactionStats {
	totalCompactions: number;
	tokensSaved: number;
	lastCompactionAt: number | null;
}

const COMPACTION_SYSTEM_PROMPT = `You are summarizing a research session to preserve context across a long conversation.

Produce a dense, structured summary that captures:
1. The research topic and goals established by the user
2. Key papers/sources found so far (title, authors, year, key contribution)
3. Decisions made (e.g., survey scope, methodology choices, experiment configs)
4. Current progress and next planned steps
5. Any critical user preferences or constraints mentioned

Format as a structured markdown document. Be comprehensive — this summary replaces the conversation history.`;

export class CompactionService {
	readonly #config: CompactionConfig;
	#stats: CompactionStats = {
		totalCompactions: 0,
		tokensSaved: 0,
		lastCompactionAt: null,
	};
	#turnsSinceLastCompaction = 0;
	#isCompacting = false;

	constructor(config: Partial<CompactionConfig> = {}) {
		this.#config = { ...DEFAULT_CONFIG, ...config };
	}

	get stats(): Readonly<CompactionStats> {
		return this.#stats;
	}

	/**
	 * Called after each agent turn with current token usage.
	 * Returns the compaction summary if compaction was triggered, or null.
	 */
	async maybeCompact(options: {
		session: AgentSession;
		modelRegistry: ModelRegistry;
		usedTokens: number;
		contextWindow: number;
	}): Promise<string | null> {
		const { session, modelRegistry, usedTokens, contextWindow } = options;
		this.#turnsSinceLastCompaction += 1;

		if (this.#isCompacting) return null;
		if (this.#turnsSinceLastCompaction < this.#config.minTurnsBetweenCompactions) return null;

		const usage = usedTokens / contextWindow;
		if (usage < this.#config.threshold) return null;

		logger.debug("CompactionService: threshold reached, compacting", {
			usage: `${(usage * 100).toFixed(1)}%`,
			usedTokens,
			contextWindow,
		});

		this.#isCompacting = true;
		try {
			const summary = await this.#runCompaction(session, modelRegistry, usedTokens);
			if (summary) {
				this.#stats.totalCompactions += 1;
				this.#stats.tokensSaved += usedTokens - this.#config.summaryMaxTokens;
				this.#stats.lastCompactionAt = Date.now();
				this.#turnsSinceLastCompaction = 0;
			}
			return summary;
		} catch (err) {
			logger.warn("CompactionService: compaction failed", { error: String(err) });
			return null;
		} finally {
			this.#isCompacting = false;
		}
	}

	async #runCompaction(
		session: AgentSession,
		modelRegistry: ModelRegistry,
		currentTokens: number,
	): Promise<string | null> {
		// Resolve the smol model for cheap summarization
		const smolModel = session.model ?? null;
		if (!smolModel) return null;

		const apiKey = await modelRegistry.getApiKey(smolModel, session.sessionManager.getSessionId());
		if (!apiKey) return null;

		// Build conversation history text for summarization
		const history = await this.#extractConversationText(session);
		if (!history.trim()) return null;

		const response = await completeSimple(
			smolModel,
			{
				systemPrompt: COMPACTION_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `Current conversation to summarize (${currentTokens} tokens):\n\n${history}`,
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey,
				maxTokens: this.#config.summaryMaxTokens,
				reasoning: Effort.Low,
			},
		);

		if (response.stopReason === "error") {
			logger.warn("CompactionService: model returned error", {
				message: response.errorMessage,
			});
			return null;
		}

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		return text || null;
	}

	async #extractConversationText(session: AgentSession): Promise<string> {
		try {
			const sessionFile = session.sessionManager.getSessionFile();
			if (!sessionFile) return "";
			const raw = await Bun.file(sessionFile).text();
			// Parse JSONL and extract text content from messages
			const lines = raw.split("\n").filter(Boolean);
			const parts: string[] = [];
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
					if (entry.type !== "message" || !entry.message) continue;
					const { role, content } = entry.message;
					if (role !== "user" && role !== "assistant") continue;
					const text =
						typeof content === "string"
							? content
							: Array.isArray(content)
								? (content as Array<{ type?: string; text?: string }>)
										.filter((c) => c.type === "text")
										.map((c) => c.text ?? "")
										.join("\n")
								: "";
					if (text.trim()) {
						parts.push(`[${role}]: ${text.trim()}`);
					}
				} catch {
					// Skip malformed lines
				}
			}
			return parts.join("\n\n");
		} catch {
			return "";
		}
	}
}
