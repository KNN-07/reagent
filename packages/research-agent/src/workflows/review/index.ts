/**
 * /review workflow — multi-model simulated peer review
 *
 * Spawns 3 reviewer sub-agents with different personas, each running as a
 * full reagent subagent with tool access (read, write, fetch, bash, etc.).
 * After all reviewers complete, aggregates into a unified report via meta-review.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { completeSimple, Effort } from "@reagent/ra-ai";
import { logger } from "@reagent/ra-utils";
import type {
	AgentDefinition,
	AgentSource,
	AuthStorage,
	ModelRegistry,
	Settings,
} from "@reagent/ra-coding-agent";
import { runSubprocess } from "@reagent/ra-coding-agent";
import reviewerAPrompt from "./prompts/reviewer-a-methods.md" with { type: "text" };
import reviewerBPrompt from "./prompts/reviewer-b-writing.md" with { type: "text" };
import reviewerCPrompt from "./prompts/reviewer-c-impact.md" with { type: "text" };

export interface ReviewConfig {
	venue: string;
	paperText: string;
	outputDir: string;
}

export interface ReviewReport {
	reviewerA: string;
	reviewerB: string;
	reviewerC: string;
	metaReview: string;
	averageScore: number;
	recommendation: string;
	outputPath: string;
}

interface ReviewerDef {
	id: "A" | "B" | "C";
	name: string;
	systemPrompt: string;
	/** Relative weight for averaging. */
	weight: number;
}

const REVIEWERS: ReviewerDef[] = [
	{ id: "A", name: "Methods Expert", systemPrompt: reviewerAPrompt, weight: 0.4 },
	{ id: "B", name: "Writing Expert", systemPrompt: reviewerBPrompt, weight: 0.3 },
	{ id: "C", name: "Impact Expert", systemPrompt: reviewerCPrompt, weight: 0.3 },
];

const META_REVIEW_SYSTEM = `You are an Area Chair writing a meta-review for a {{venue}} submission.

You have received three individual peer reviews. Synthesize them into a meta-review that:
1. Summarizes the consensus strengths and weaknesses
2. Resolves any disagreements between reviewers
3. Provides an overall recommendation with clear justification
4. Lists the most critical required revisions (top 3–5)

Format:
## Meta-Review

**Consensus Score**: X/10
**Final Recommendation**: Accept / Weak Accept / Borderline / Weak Reject / Reject

### Consensus Strengths
- ...

### Consensus Weaknesses
- ...

### Critical Revisions Required
1. ...

### Reviewer Disagreements
(describe any significant disagreements and how they resolve)

### AC Comments
(area chair perspective on the paper's fit for the venue)`;

/**
 * Run the full simulated peer review pipeline.
 *
 * Each of the 3 reviewers runs as a full reagent subagent with tool access,
 * allowing them to read the paper from disk, follow citations, etc.
 * The meta-review uses a direct LLM call to synthesize the three reviews.
 */
export async function runReview(
	config: ReviewConfig,
	modelRegistry: ModelRegistry,
	sessionId: string,
	options?: { settings?: Settings },
): Promise<ReviewReport> {
	await fs.mkdir(config.outputDir, { recursive: true });

	// Write the paper to a file so subagent reviewers can access it via read tool
	const paperFilePath = path.join(config.outputDir, "paper-under-review.md");
	await Bun.write(paperFilePath, config.paperText);

	// authStorage is a public readonly field on ModelRegistry
	const authStorage: AuthStorage = (modelRegistry as unknown as { authStorage: AuthStorage }).authStorage;

	// Run all 3 reviewers in parallel as full subagents
	logger.debug("Review: starting 3 parallel reviewer subagents", { venue: config.venue, outputDir: config.outputDir });

	const [reviewA, reviewB, reviewC] = await Promise.all(
		REVIEWERS.map((reviewer, i) =>
			runSingleReview(reviewer, config, paperFilePath, sessionId, i, {
				authStorage,
				modelRegistry,
				settings: options?.settings,
			}),
		),
	);

	// Generate meta-review via direct LLM call (synthesis only — no tool access needed)
	const allReviews = `# Review A (${REVIEWERS[0]!.name})\n\n${reviewA}\n\n---\n\n# Review B (${REVIEWERS[1]!.name})\n\n${reviewB}\n\n---\n\n# Review C (${REVIEWERS[2]!.name})\n\n${reviewC}`;

	const metaReview = await runMetaReview(config.venue, allReviews, modelRegistry, sessionId);

	// Parse scores from reviews (simple regex)
	const scores = [reviewA, reviewB, reviewC].map(extractScore);
	const averageScore = scores.reduce((sum, s, i) => sum + s * REVIEWERS[i]!.weight, 0);

	const recommendation = classifyRecommendation(averageScore);

	// Write consolidated report
	const report = buildReportMarkdown({
		config,
		reviewA: reviewA ?? "",
		reviewB: reviewB ?? "",
		reviewC: reviewC ?? "",
		metaReview,
		averageScore,
		recommendation,
	});

	const outputPath = path.join(config.outputDir, "review-report.md");
	await Bun.write(outputPath, report);

	logger.debug("Review completed", { outputPath, averageScore, recommendation });

	return {
		reviewerA: reviewA ?? "",
		reviewerB: reviewB ?? "",
		reviewerC: reviewC ?? "",
		metaReview,
		averageScore,
		recommendation,
		outputPath,
	};
}

/**
 * Run a single reviewer as a full reagent subagent.
 *
 * The subagent has access to all standard tools (read, write, bash, fetch, etc.)
 * allowing it to read the paper file, follow references, and write notes.
 * It submits its review via the submit_result tool.
 */
async function runSingleReview(
	reviewer: ReviewerDef,
	config: ReviewConfig,
	paperFilePath: string,
	sessionId: string,
	reviewerIndex: number,
	options: {
		authStorage?: AuthStorage;
		modelRegistry: ModelRegistry;
		settings?: Settings;
	},
): Promise<string> {
	const systemPrompt = reviewer.systemPrompt.replace(/\{\{venue\}\}/g, config.venue);

	const agentDef: AgentDefinition = {
		name: `reviewer-${reviewer.id.toLowerCase()}`,
		description: `Peer reviewer — ${reviewer.name}`,
		systemPrompt,
		source: "project" as AgentSource,
	};

	const reviewerDir = path.join(config.outputDir, `.reviewer-${reviewer.id.toLowerCase()}`);

	const task = `You are conducting peer review for a submission to ${config.venue}.

The paper under review is at: ${paperFilePath}

Please:
1. Read the full paper using the \`read\` tool
2. Evaluate it according to your expertise (${reviewer.name})
3. Write a detailed review covering:
   - Summary of the paper
   - Strengths
   - Weaknesses
   - Detailed comments
   - An overall score formatted exactly as: "Overall score: X/10"
   - A recommendation: Accept / Weak Accept / Borderline / Weak Reject / Reject

You may use additional tools (bash, fetch, web_search) to look up cited papers, verify claims, or check related work.

When you have finished your review, call the \`submit_result\` tool with your complete review text.`;

	try {
		const result = await runSubprocess({
			cwd: reviewerDir,
			agent: agentDef,
			task,
			index: reviewerIndex,
			id: `review-${sessionId}-reviewer-${reviewer.id}`,
			authStorage: options.authStorage,
			modelRegistry: options.modelRegistry,
			settings: options.settings,
			enableLsp: false,
			artifactsDir: reviewerDir,
		});

		if (result.exitCode !== 0) {
			logger.warn(`Reviewer ${reviewer.id} subagent failed`, { error: result.error });
			return `[Reviewer ${reviewer.id} (${reviewer.name}) failed: ${result.error ?? `exit code ${result.exitCode}`}]`;
		}

		// output is the submit_result content or final agent output
		return result.output || `[Reviewer ${reviewer.id} produced no output]`;
	} catch (err) {
		logger.warn(`Reviewer ${reviewer.id} threw an error`, { err });
		return `[Reviewer ${reviewer.id} (${reviewer.name}) error: ${String(err)}]`;
	}
}

async function runMetaReview(
	venue: string,
	allReviews: string,
	modelRegistry: ModelRegistry,
	sessionId: string,
): Promise<string> {
	const models = (await modelRegistry.listModels?.()) ?? [];
	const model = models[0] ?? null;
	if (!model) return "[No model available for meta-review]";

	const apiKey = await modelRegistry.getApiKey(model, sessionId);
	if (!apiKey) return "[No API key for meta-review]";

	const systemPrompt = META_REVIEW_SYSTEM.replace(/\{\{venue\}\}/g, venue);

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: allReviews }],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey, maxTokens: 2000, reasoning: Effort.High },
		);

		if (response.stopReason === "error") return `[Meta-review error: ${response.errorMessage}]`;

		return response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
	} catch (err) {
		return `[Meta-review failed: ${String(err)}]`;
	}
}

function extractScore(review: string): number {
	const match = review.match(/Overall score[:\s]*(\d+(?:\.\d+)?)\s*\/\s*10/i);
	return match ? parseFloat(match[1]!) : 5;
}

function classifyRecommendation(score: number): string {
	if (score >= 8) return "Accept";
	if (score >= 7) return "Weak Accept";
	if (score >= 5.5) return "Borderline";
	if (score >= 4) return "Weak Reject";
	return "Reject";
}

function buildReportMarkdown(params: {
	config: ReviewConfig;
	reviewA: string;
	reviewB: string;
	reviewC: string;
	metaReview: string;
	averageScore: number;
	recommendation: string;
}): string {
	const { config, reviewA, reviewB, reviewC, metaReview, averageScore, recommendation } = params;
	const date = new Date().toISOString().slice(0, 10);

	return `# Peer Review Report
**Venue**: ${config.venue}
**Date**: ${date}
**Average Score**: ${averageScore.toFixed(1)}/10
**Recommendation**: ${recommendation}

---

## Meta-Review (Area Chair)

${metaReview}

---

## Review A — Methods Expert

${reviewA}

---

## Review B — Writing Expert

${reviewB}

---

## Review C — Broader Impact Expert

${reviewC}
`;
}

export const REVIEW_SLASH_COMMAND_PROMPT = `
You are running the ReAgent /review workflow — simulated peer review.

Ask the user:
1. Path or content of the paper to review (PDF, LaTeX source, or paste text)
2. Target venue (e.g., NeurIPS 2025, ICML, ACL, Nature Machine Intelligence)

Then run the review using the review tools and present the consolidated report.
`.trim();
