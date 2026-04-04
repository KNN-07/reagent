/**
 * KairosMemory — Background Memory Consolidation for ReAgent
 *
 * Adapted from oh-my-pi's packages/coding-agent/src/memories/index.ts.
 * Provides a two-phase background memory pipeline tailored for research sessions:
 *
 * Phase 1 (per-session): Scans JSONL session logs, extracts memorable research
 *   facts using a small model (citations found, experiment outcomes, decisions).
 *
 * Phase 2 (global): Merges raw memories into MEMORY.md index + topic files.
 *   Generates research-domain memory types: paper_citation, research_finding,
 *   experiment_result, survey_topic.
 *
 * Storage: ~/.reagent/memory/<project-slug>/
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { completeSimple, Effort } from "@reagent/ra-ai";
import { logger } from "@reagent/ra-utils";
import type { ModelRegistry } from "@reagent/ra-coding-agent/config/model-registry";
import type { AgentSession } from "@reagent/ra-coding-agent/session/agent-session";
import { CONFIG_DIR } from "../version";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ResearchMemoryType =
	| "paper_citation"      // A paper found during research
	| "research_finding"    // A key insight or result
	| "experiment_result"   // An autoresearch run outcome
	| "survey_topic"        // A topic area being surveyed
	| "user_preference"     // User workflow preferences
	| "project_context";    // Project-specific context

export interface ResearchMemoryEntry {
	type: ResearchMemoryType;
	title: string;
	description: string;
	/** ISO date string */
	date: string;
	/** Optional: arXiv ID, DOI, or URL for citations */
	source?: string;
	/** Optional: linked survey or paper slug */
	linkedTo?: string;
}

export interface KairosMemoryConfig {
	enabled: boolean;
	/** Project slug used as the memory namespace */
	projectSlug: string;
	/** Max session files to scan per startup */
	maxThreadScan: number;
	/** Number of memory phases to retain (rolling window) */
	retentionDays: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

export function getMemoryRoot(projectSlug: string): string {
	return path.join(os.homedir(), CONFIG_DIR, "memory", projectSlug);
}

export function getMemoryEntrypoint(projectSlug: string): string {
	return path.join(getMemoryRoot(projectSlug), "MEMORY.md");
}

export function getRawMemoriesPath(projectSlug: string): string {
	return path.join(getMemoryRoot(projectSlug), "raw_memories.md");
}

// ─── Phase 1 Prompt ─────────────────────────────────────────────────────────

const PHASE1_SYSTEM = `You are a research memory extractor. Given a conversation log from a research session, extract memorable facts worth preserving for future sessions.

Focus on:
- Papers cited or discussed (title, authors, year, key contribution)
- Research findings and insights
- Experiment results (metric values, comparisons)
- Survey topics and their scope
- User preferences and workflow decisions

Output JSON with this schema:
{
  "entries": [
    {
      "type": "paper_citation" | "research_finding" | "experiment_result" | "survey_topic" | "user_preference" | "project_context",
      "title": "short title",
      "description": "1-2 sentence description",
      "source": "optional URL/DOI/arXiv ID",
      "linkedTo": "optional survey or paper slug"
    }
  ],
  "summary": "2-3 sentence session summary"
}

If nothing memorable happened, return {"entries": [], "summary": "No memorable research activity."}.
Output ONLY valid JSON, no prose.`;

// ─── Phase 2 Prompt ─────────────────────────────────────────────────────────

const PHASE2_SYSTEM = `You are a research memory consolidator. Given raw memory entries from multiple sessions, produce a clean MEMORY.md index.

Structure the output as:
# Research Memory

## Papers
- [Title](source) — key contribution (year)

## Findings
- description

## Experiments
- description of outcome

## Survey Topics
- topic — brief scope

## Preferences
- user preference items

Be concise. Each entry max 1 line. Output ONLY the markdown, no JSON wrapper.`;

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Start the background memory pipeline for ReAgent.
 * Fire-and-forget — errors are logged, never thrown.
 */
export function startMemoryPipeline(options: {
	session: AgentSession;
	modelRegistry: ModelRegistry;
	config: KairosMemoryConfig;
}): void {
	if (!options.config.enabled) return;

	void runMemoryPipeline(options).catch((err) => {
		logger.warn("KairosMemory: pipeline failed", { error: String(err) });
	});
}

async function runMemoryPipeline(options: {
	session: AgentSession;
	modelRegistry: ModelRegistry;
	config: KairosMemoryConfig;
}): Promise<void> {
	const { session, modelRegistry, config } = options;
	const memoryRoot = getMemoryRoot(config.projectSlug);
	await fs.mkdir(memoryRoot, { recursive: true });

	const model = session.model;
	if (!model) return;

	const apiKey = await modelRegistry.getApiKey(model, session.sessionManager.getSessionId());
	if (!apiKey) return;

	// Phase 1: extract from current session
	const sessionFile = session.sessionManager.getSessionFile();
	if (sessionFile) {
		await runPhase1({ sessionFile, projectSlug: config.projectSlug, model, apiKey });
	}

	// Phase 2: consolidate all raw memories into MEMORY.md
	await runPhase2({ projectSlug: config.projectSlug, model, apiKey });
}

async function runPhase1(options: {
	sessionFile: string;
	projectSlug: string;
	model: { provider: string; id: string };
	apiKey: string;
}): Promise<void> {
	const { sessionFile, projectSlug, model, apiKey } = options;

	let raw = "";
	try {
		raw = await Bun.file(sessionFile).text();
	} catch {
		return;
	}

	if (!raw.trim()) return;

	// Extract user+assistant messages
	const lines = raw.split("\n").filter(Boolean);
	const messages: string[] = [];
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
								.join(" ")
						: "";
			if (text.trim()) messages.push(`${role}: ${text.slice(0, 2000)}`);
		} catch { /* skip */ }
	}

	if (messages.length < 3) return; // Too short to be worth extracting

	const response = await completeSimple(
		model,
		{
			systemPrompt: PHASE1_SYSTEM,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: messages.join("\n\n").slice(0, 30_000) }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, maxTokens: 2048, reasoning: Effort.Low },
	);

	if (response.stopReason === "error") return;

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();

	// Write to raw_memories.md (appending)
	const rawPath = getRawMemoriesPath(projectSlug);
	const timestamp = new Date().toISOString();
	const block = `\n\n## Session ${timestamp}\n${text}`;
	await Bun.write(rawPath, (await readFileSafe(rawPath)) + block);
	logger.debug("KairosMemory: phase1 complete", { projectSlug });
}

async function runPhase2(options: {
	projectSlug: string;
	model: { provider: string; id: string };
	apiKey: string;
}): Promise<void> {
	const { projectSlug, model, apiKey } = options;
	const rawPath = getRawMemoriesPath(projectSlug);
	const rawContent = await readFileSafe(rawPath);

	if (!rawContent.trim()) return;

	const response = await completeSimple(
		model,
		{
			systemPrompt: PHASE2_SYSTEM,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: rawContent.slice(0, 40_000) }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, maxTokens: 4096, reasoning: Effort.Medium },
	);

	if (response.stopReason === "error") return;

	const memoryMd = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();

	if (!memoryMd) return;

	const entrypoint = getMemoryEntrypoint(projectSlug);
	await Bun.write(entrypoint, `${memoryMd}\n`);
	logger.debug("KairosMemory: phase2 complete", { projectSlug, entrypoint });
}

// ─── Memory Reading ──────────────────────────────────────────────────────────

/**
 * Load the MEMORY.md content for injection into the system prompt.
 * Returns null if no memory exists yet.
 */
export async function loadMemoryForPrompt(projectSlug: string): Promise<string | null> {
	const entrypoint = getMemoryEntrypoint(projectSlug);
	const content = await readFileSafe(entrypoint);
	if (!content.trim()) return null;

	// Truncate to 200 lines / 25k chars (matching Claude Code's limits)
	const lines = content.split("\n");
	const truncated = lines.length > 200 ? lines.slice(0, 200).join("\n") + "\n\n> [Memory truncated — too many entries]" : content;
	return truncated.slice(0, 25_000);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string> {
	try {
		return await Bun.file(filePath).text();
	} catch {
		return "";
	}
}
