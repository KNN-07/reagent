/**
 * /review workflow — multi-model simulated peer review
 *
 * Spawns 3 reviewer sub-agents with different personas and models,
 * then aggregates into a unified report with meta-review.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { completeSimple, Effort } from "@reagent/ra-ai";
import { logger } from "@reagent/ra-utils";
import type { ModelRegistry } from "@reagent/ra-coding-agent/config/model-registry";
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
 */
export async function runReview(
	config: ReviewConfig,
	modelRegistry: ModelRegistry,
	sessionId: string,
): Promise<ReviewReport> {
	await fs.mkdir(config.outputDir, { recursive: true });

	// Run all 3 reviewers in parallel
	const [reviewA, reviewB, reviewC] = await Promise.all(
		REVIEWERS.map((reviewer) => runSingleReview(reviewer, config, modelRegistry, sessionId)),
	);

	// Generate meta-review
	const allReviews = `# Review A (${REVIEWERS[0]!.name})\n\n${reviewA}\n\n---\n\n# Review B (${REVIEWERS[1]!.name})\n\n${reviewB}\n\n---\n\n# Review C (${REVIEWERS[2]!.name})\n\n${reviewC}`;

	const metaReview = await runMetaReview(
		config.venue,
		allReviews,
		modelRegistry,
		sessionId,
	);

	// Parse scores from reviews (simple regex)
	const scores = [reviewA, reviewB, reviewC].map(extractScore);
	const averageScore =
		scores.reduce((sum, s, i) => sum + s * REVIEWERS[i]!.weight, 0);

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

async function runSingleReview(
	reviewer: ReviewerDef,
	config: ReviewConfig,
	modelRegistry: ModelRegistry,
	sessionId: string,
): Promise<string> {
	const systemPrompt = reviewer.systemPrompt.replace("{{venue}}", config.venue);

	// Use the default model — in a real multi-model setup, each reviewer would
	// use a different model (e.g., claude-sonnet / gemini-flash / gpt-4o).
	// The model registry will use whatever is configured for the session.
	const models = await modelRegistry.listModels?.() ?? [];
	const model = models[0] ?? null;
	if (!model) {
		return `[Error: No model available for Reviewer ${reviewer.id}]`;
	}

	const apiKey = await modelRegistry.getApiKey(model, sessionId);
	if (!apiKey) {
		return `[Error: No API key for Reviewer ${reviewer.id}]`;
	}

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `Please review the following paper for ${config.venue}:\n\n${config.paperText.slice(0, 60_000)}`,
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey, maxTokens: 3000, reasoning: Effort.Medium },
		);

		if (response.stopReason === "error") return `[Review error: ${response.errorMessage}]`;

		return response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
	} catch (err) {
		return `[Review failed: ${String(err)}]`;
	}
}

async function runMetaReview(
	venue: string,
	allReviews: string,
	modelRegistry: ModelRegistry,
	sessionId: string,
): Promise<string> {
	const models = await modelRegistry.listModels?.() ?? [];
	const model = models[0] ?? null;
	if (!model) return "[No model available for meta-review]";

	const apiKey = await modelRegistry.getApiKey(model, sessionId);
	if (!apiKey) return "[No API key for meta-review]";

	const systemPrompt = META_REVIEW_SYSTEM.replace("{{venue}}", venue);

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
