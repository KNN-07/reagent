/**
 * /autopaper workflow — end-to-end paper generation pipeline
 *
 * Orchestrates: Survey → AutoResearch → Lean Verification → LaTeX Paper → Review
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@reagent/ra-utils";
import { listExistingSurveys } from "../survey/index";
import { AUTORESEARCH_SLASH_COMMAND_PROMPT } from "../autoresearch/index";
import { PAPERS_DIR, SURVEYS_DIR } from "../../version";

export interface AutopaperConfig {
	topic: string;
	idea?: string;
	venue: "neurips" | "icml" | "iclr" | "acl" | "emnlp" | "nature" | "custom";
	useExistingSurvey?: string; // slug of existing survey to reuse
	skipSurvey?: boolean;
	skipLean?: boolean;
	skipReview?: boolean;
}

export interface AutopaperState {
	phase:
		| "survey"
		| "planning"
		| "autoresearch"
		| "lean_verification"
		| "writing"
		| "review"
		| "done";
	surveyDir?: string;
	experimentDir?: string;
	paperDir?: string;
	paperLatex?: string;
	paperPdf?: string;
	reviewReport?: string;
	leanReport?: string;
}

/**
 * Build the paper output directory.
 */
export function buildPaperOutputDir(cwd: string, topic: string): string {
	const slug = topic
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 40)
		.replace(/-+$/, "");
	const date = new Date().toISOString().slice(0, 10);
	return path.join(cwd, PAPERS_DIR, `${slug}-${date}`);
}

/**
 * List existing surveys for reuse selection.
 */
export async function getExistingSurveyOptions(cwd: string): Promise<{
	hasSurveys: boolean;
	surveys: string[];
}> {
	const surveys = await listExistingSurveys(cwd);
	return { hasSurveys: surveys.length > 0, surveys };
}

const PAPER_WRITER_SYSTEM = `You are a senior AI/ML researcher writing a paper for {{venue}}.

You have completed:
1. A literature survey (see context)
2. Automated experiments with results (see context)
3. Mathematical proofs (verified with Lean 4 where applicable)

## Paper Structure ({{venue}} format)
1. **Abstract** (250 words max) — contribution, method, key result
2. **Introduction** — motivation, research gap, contributions (bullet list)
3. **Related Work** — cite survey findings, differentiate your work
4. **Method** — your proposed approach with formal notation
5. **Experiments** — setup, baselines, results table, ablations
6. **Analysis** — what do the results mean? limitations?
7. **Conclusion** — summary and future work
8. **References** — from the survey BibTeX

## Requirements
- Follow {{venue}} style guide (column format, page limit)
- Every claim backed by either an experiment result or a citation
- Comparison table: your method vs. baselines on key metrics
- At least one figure (training curve, architecture diagram, or ablation)
- Limitations section (honest, 1 paragraph)
- No plagiarism of survey sources — synthesize and cite

## Experiment Results to Report
{{experiment_summary}}

## Survey Context
Key papers from the survey are available in the conversation context.
`;

/**
 * The slash command prompt for /autopaper.
 */
export const AUTOPAPER_SLASH_COMMAND_PROMPT = `
You are running the ReAgent /autopaper workflow — end-to-end paper generation.

## Phase 0: Topic Intake
Ask the user:
1. What is the research topic/idea? (be specific — a method, a phenomenon, a problem)
2. Target venue? (NeurIPS / ICML / ICLR / ACL / Nature / other)

## Phase 1: Survey
Check if surveys already exist in ./surveys/:
- If surveys exist, list them and ask: "Use an existing survey or run a new one?"
- If none exist, run /survey automatically on the topic

## Phase 2: Idea Refinement
Based on the survey findings, present 3–5 concrete research directions the user can pursue.
Ask the user to select one or describe their own idea.

Ask any clarifying questions about:
- The proposed method or algorithm
- What baselines to compare against
- Dataset preferences
- Compute budget for experiments

## Phase 3: AutoResearch
Set up the experiment environment:
- Help user create autoresearch.md with the right benchmark command
- Run /autoresearch to automatically optimize the approach
- Continue until a satisfying result is achieved or user stops

## Phase 4: Math Verification (optional)
If any mathematical claims were made (theorems, bounds, complexity claims):
- Generate Lean 4 proofs
- Run verification (skip if Lean not installed)

## Phase 5: Paper Writing
Using the highest-quality model available, write the full LaTeX paper.
Follow the ${PAPERS_DIR} structure for outputs.

## Phase 6: Review
Run /review on the draft paper.
Present the review report to the user.
Ask: "Would you like to revise based on reviewer feedback? [y/n]"
If yes, make the revisions and re-review until score >= 7/10.

## Final Output
- LaTeX source + PDF
- Review report
- Lean verification report (if applicable)
- SUMMARY.md
`.trim();

export { PAPER_WRITER_SYSTEM };
