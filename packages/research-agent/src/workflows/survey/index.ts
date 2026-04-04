/**
 * /survey workflow — main slash command handler
 *
 * Registered as a FileSlashCommand at session startup.
 * Flow: interview → confirm scope → research → write LaTeX/PDF/MD → verify citations
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import interviewPrompt from "./prompts/interview.md" with { type: "text" };
import researcherPrompt from "./prompts/researcher.md" with { type: "text" };
import writerPrompt from "./prompts/writer.md" with { type: "text" };
import type { SurveyScope, SurveyOutput } from "./types";
import { DEFAULT_SURVEY_SCOPE } from "./types";
import { getLatexBinary } from "../../tools/dependency-check";
import { SURVEYS_DIR } from "../../version";

export { interviewPrompt, researcherPrompt, writerPrompt };

/**
 * Build the output directory path for a survey.
 * Format: <cwd>/surveys/<slug>-<YYYY-MM-DD>/
 */
export function buildSurveyOutputDir(cwd: string, topic: string): string {
	const slug = topic
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 40)
		.replace(/-+$/, "");
	const date = new Date().toISOString().slice(0, 10);
	return path.join(cwd, SURVEYS_DIR, `${slug}-${date}`);
}

/**
 * Ensure the survey output directory exists.
 */
export async function ensureSurveyDir(outputDir: string): Promise<void> {
	await fs.mkdir(outputDir, { recursive: true });
}

/**
 * Build the researcher prompt from a confirmed scope.
 */
export function buildResearcherPrompt(scope: SurveyScope): string {
	return researcherPrompt
		.replace("{{topic}}", scope.topic)
		.replace("{{keywords}}", scope.keywords.join(", "))
		.replace("{{time_range}}", `${scope.timeRange.from}–${scope.timeRange.to}`)
		.replace("{{venues}}", scope.venues.join(", "))
		.replace("{{depth}}", scope.depth);
}

/**
 * Build the writer prompt from scope + research results + latex binary info.
 */
export async function buildWriterPrompt(
	scope: SurveyScope,
	researchJson: string,
	outputDir: string,
): Promise<string> {
	const latexBinary = await getLatexBinary();
	return writerPrompt
		.replace("{{topic}}", scope.topic)
		.replace("{{latex_template}}", scope.latexTemplate)
		.replace("{{output_dir}}", outputDir)
		.replace("{{research_json}}", researchJson)
		.replace("{{latex_binary}}", latexBinary ?? "# No LaTeX compiler found — output .tex source only");
}

/**
 * Load existing surveys from the working directory for reuse.
 */
export async function listExistingSurveys(cwd: string): Promise<string[]> {
	const surveysDir = path.join(cwd, SURVEYS_DIR);
	try {
		const entries = await fs.readdir(surveysDir, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort()
			.reverse(); // Most recent first
	} catch {
		return [];
	}
}

/**
 * Check if a survey output directory has a compiled PDF.
 */
export async function surveyHasPdf(outputDir: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(outputDir);
		return entries.some((e) => e.endsWith(".pdf"));
	} catch {
		return false;
	}
}

/**
 * The slash command definition for /survey.
 * System prompt text injected at the start of the /survey command.
 */
export const SURVEY_SLASH_COMMAND_PROMPT = `
You are running the ReAgent /survey workflow. Your goal is to produce a comprehensive academic survey.

## Phase 1: Interview
${interviewPrompt}

After confirming the scope, clearly announce: "**Starting research phase...**"

## Phase 2: Research
Use the research tools (exa_researcher_start, exa_researcher_poll, exa_search, fetch) to find papers.
Follow the research protocol strictly — verify every citation before including it.

After completing research, announce: "**Research complete. Writing survey...**"

## Phase 3: Writing
Generate the LaTeX source, BibTeX file, and Markdown summary.
Compile to PDF if a LaTeX compiler is available.
Run the citation verification pass.

## Final Output
Report:
- ✓ Total papers found and verified
- ✓ Output files created (list paths)
- ⚠ Any citation issues found
- Summary of main themes
`.trim();
