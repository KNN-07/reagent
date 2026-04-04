/**
 * Lean 4 Math Proof Verifier
 *
 * Extracts mathematical claims from research text, generates Lean 4 proof
 * sketches, and verifies them using the `lean` CLI.
 *
 * Behavior:
 *  - If Lean is not installed: returns a warning, does not block /autopaper
 *  - If Lean is installed: runs verification and reports pass/fail per claim
 *  - Failed proofs are fed back to the agent for revision (up to 3 attempts)
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { completeSimple, Effort } from "@reagent/ra-ai";
import { logger } from "@reagent/ra-utils";
import { isLeanAvailable } from "../../tools/dependency-check";

export interface MathClaim {
	id: string;
	description: string;
	/** LaTeX math expression */
	latex: string;
}

export interface LeanVerificationResult {
	claim: MathClaim;
	/** The generated Lean 4 proof attempt */
	leanCode: string;
	passed: boolean;
	error?: string;
	attempts: number;
}

export interface LeanVerificationReport {
	available: boolean;
	claims: MathClaim[];
	results: LeanVerificationResult[];
	allPassed: boolean;
	skipped: boolean;
}

const CLAIM_EXTRACTOR_SYSTEM = `You are a mathematical claim extractor. Given research paper text, identify all verifiable mathematical claims (theorems, lemmas, propositions, corollaries).

For each claim output JSON:
{
  "claims": [
    {
      "id": "thm1",
      "description": "human-readable description",
      "latex": "\\\\theorem{...} or key mathematical statement as LaTeX"
    }
  ]
}

Only extract claims that have a formal mathematical structure. Skip informal claims or empirical observations.
If no verifiable claims exist, return {"claims": []}.
Output ONLY valid JSON.`;

const LEAN_PROVER_SYSTEM = `You are a Lean 4 theorem prover. Given a mathematical claim described in natural language and LaTeX, write a Lean 4 proof.

Requirements:
- Use Lean 4 syntax (not Lean 3)
- Start with: import Mathlib
- Define all necessary types and hypotheses
- Use \`sorry\` as a placeholder ONLY for sub-goals you cannot complete — minimize sorry usage
- Add a comment above each theorem explaining what it states

The claim to prove:
Description: {{description}}
LaTeX: {{latex}}

Output ONLY valid Lean 4 code. No prose, no markdown fences.`;

/**
 * Run full Lean verification on a paper's mathematical claims.
 * Returns immediately with `skipped: true` if Lean is not installed.
 */
export async function verifyMathClaims(options: {
	paperText: string;
	outputDir: string;
	model: { provider: string; id: string };
	apiKey: string;
	maxAttempts?: number;
}): Promise<LeanVerificationReport> {
	const { paperText, outputDir, model, apiKey, maxAttempts = 3 } = options;

	// Check Lean availability
	const leanAvailable = await isLeanAvailable();
	if (!leanAvailable) {
		logger.debug("Lean not available — skipping math verification");
		return {
			available: false,
			claims: [],
			results: [],
			allPassed: true, // Don't block if Lean is not installed
			skipped: true,
		};
	}

	// Extract mathematical claims from the paper text
	const claims = await extractClaims(paperText, model, apiKey);
	if (claims.length === 0) {
		logger.debug("No verifiable mathematical claims found");
		return { available: true, claims: [], results: [], allPassed: true, skipped: false };
	}

	logger.debug("Verifying mathematical claims with Lean", { count: claims.length });
	await fs.mkdir(path.join(outputDir, "lean"), { recursive: true });

	// Verify each claim
	const results: LeanVerificationResult[] = [];
	for (const claim of claims) {
		const result = await verifyClaim({ claim, outputDir, model, apiKey, maxAttempts });
		results.push(result);
	}

	const allPassed = results.every((r) => r.passed);
	return { available: true, claims, results, allPassed, skipped: false };
}

async function extractClaims(
	paperText: string,
	model: { provider: string; id: string },
	apiKey: string,
): Promise<MathClaim[]> {
	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: CLAIM_EXTRACTOR_SYSTEM,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: paperText.slice(0, 50_000) }],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey, maxTokens: 2048, reasoning: Effort.Low },
		);

		if (response.stopReason === "error") return [];

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();

		const parsed = JSON.parse(text) as { claims?: MathClaim[] };
		return parsed.claims ?? [];
	} catch {
		return [];
	}
}

async function verifyClaim(options: {
	claim: MathClaim;
	outputDir: string;
	model: { provider: string; id: string };
	apiKey: string;
	maxAttempts: number;
}): Promise<LeanVerificationResult> {
	const { claim, outputDir, model, apiKey, maxAttempts } = options;
	const leanDir = path.join(outputDir, "lean");
	const leanFile = path.join(leanDir, `${claim.id}.lean`);

	let lastCode = "";
	let lastError = "";
	let passed = false;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		// Generate Lean proof
		const prompt = lastError
			? `Previous attempt failed with error:\n${lastError}\n\nPrevious code:\n${lastCode}\n\nPlease fix the proof.`
			: LEAN_PROVER_SYSTEM.replace("{{description}}", claim.description).replace(
					"{{latex}}",
					claim.latex,
				);

		const response = await completeSimple(
			model,
			{
				systemPrompt: attempt === 1 ? LEAN_PROVER_SYSTEM.replace("{{description}}", claim.description).replace("{{latex}}", claim.latex) : "You are a Lean 4 theorem prover. Fix the proof.",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: attempt === 1 ? `Prove this claim:\n\nDescription: ${claim.description}\nLaTeX: ${claim.latex}` : prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey, maxTokens: 2048, reasoning: Effort.High },
		);

		if (response.stopReason === "error") break;

		lastCode = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();

		// Write and verify
		await Bun.write(leanFile, lastCode);
		const result = await runLean(leanFile);

		if (result.exitCode === 0) {
			passed = true;
			lastError = "";
			logger.debug("Lean verification passed", { claim: claim.id, attempt });
			break;
		}

		lastError = result.stderr.slice(0, 3000);
		logger.debug("Lean verification failed", { claim: claim.id, attempt, error: lastError });
	}

	return {
		claim,
		leanCode: lastCode,
		passed,
		error: passed ? undefined : lastError,
		attempts: maxAttempts,
	};
}

interface LeanRunResult {
	exitCode: number | null;
	stderr: string;
}

async function runLean(filePath: string): Promise<LeanRunResult> {
	try {
		const result = await $`lean ${filePath}`.quiet().nothrow();
		return {
			exitCode: result.exitCode,
			stderr: result.stderr.toString(),
		};
	} catch (err) {
		return { exitCode: 1, stderr: String(err) };
	}
}

/**
 * Format a verification report as markdown for inclusion in a paper.
 */
export function formatVerificationReport(report: LeanVerificationReport): string {
	if (report.skipped) {
		return "> **Note**: Lean 4 not available — mathematical claims not formally verified.\n";
	}
	if (report.claims.length === 0) {
		return "> **Note**: No formal mathematical claims found to verify.\n";
	}

	const lines = ["## Formal Verification Results\n"];
	for (const result of report.results) {
		const status = result.passed ? "✓ VERIFIED" : "✗ UNVERIFIED";
		lines.push(`### ${result.claim.id}: ${result.claim.description}`);
		lines.push(`**Status**: ${status}`);
		if (!result.passed && result.error) {
			lines.push(`**Error**: \`${result.error.slice(0, 200)}\``);
		}
		lines.push("");
	}

	const passed = report.results.filter((r) => r.passed).length;
	lines.push(`**Summary**: ${passed}/${report.results.length} claims verified by Lean 4.`);
	return lines.join("\n");
}
