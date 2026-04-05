/**
 * Workflow guard – shared state types and enforcement contracts.
 *
 * Defines the phase model for /survey, /autoresearch, and /autopaper,
 * including which tools are allowed in each phase and what output files
 * are required at completion.
 */

// ============================================================================
// Workflow + Phase types
// ============================================================================

export type WorkflowName = "survey" | "autoresearch" | "autopaper";

export type SurveyPhase = "interview" | "research" | "writing" | "done";
export type AutoresearchPhase = "setup" | "baseline" | "loop" | "done";
export type AutopaperPhase = "intake" | "survey" | "ideation" | "autoresearch" | "lean" | "writing" | "review" | "done";
export type WorkflowPhase = SurveyPhase | AutoresearchPhase | AutopaperPhase;

export interface WorkflowState {
	workflow: WorkflowName;
	phase: WorkflowPhase;
	startedAt: number;
	updatedAt: number;
	/** Absolute path to the workflow's output directory (if known). Populated after Phase 1. */
	outputDir?: string;
}

// ============================================================================
// Phase → allowed tools
// ============================================================================

/**
 * Set of tool names that are BLOCKED in each phase.
 * Any tool not in the blocked set is allowed.
 * We block rather than allowlist because the LLM uses many utility tools
 * (context, read, grep, find) in every phase.
 */
export const PHASE_BLOCKED_TOOLS: Record<WorkflowName, Partial<Record<WorkflowPhase, Set<string>>>> = {
	survey: {
		interview: new Set(["exa_researcher_start", "exa_researcher_poll", "exa_search"]),
		research: new Set(["write"]), // cannot write output files until writing phase
		writing: new Set(["exa_researcher_start", "exa_researcher_poll"]), // no more research kicks
		done: new Set(),
	},
	autoresearch: {
		setup: new Set(["bash"]), // no bash until config is confirmed
		baseline: new Set([]), // baseline: anything read + bash
		loop: new Set([]), // loop: unrestricted (editing experiment code is the entire point)
		done: new Set(),
	},
	autopaper: {
		intake: new Set([]),
		survey: new Set([]),
		ideation: new Set([]),
		autoresearch: new Set([]),
		lean: new Set(["write", "edit"]), // lean phase: only bash (lean4) allowed, no source edits
		writing: new Set([]),
		review: new Set(["write", "edit", "bash"]), // review is subagent-driven
		done: new Set(),
	},
};

// ============================================================================
// Phase triggers – exact announcement strings baked into prompts
// ============================================================================

/** Maps (workflow, announcement text fragment) → next phase */
export interface PhaseTrigger {
	workflow: WorkflowName;
	/** Fragment that must appear in the assistant message text */
	fragment: string;
	nextPhase: WorkflowPhase;
}

export const PHASE_TRIGGERS: PhaseTrigger[] = [
	// /survey
	{ workflow: "survey", fragment: "Starting research phase", nextPhase: "research" },
	{ workflow: "survey", fragment: "Research complete. Writing survey", nextPhase: "writing" },
	{ workflow: "survey", fragment: "Research complete. Writing", nextPhase: "writing" },
	// /autoresearch
	{ workflow: "autoresearch", fragment: "benchmark command", nextPhase: "baseline" },
	{ workflow: "autoresearch", fragment: "Running baseline", nextPhase: "baseline" },
	{ workflow: "autoresearch", fragment: "baseline complete", nextPhase: "loop" },
	{ workflow: "autoresearch", fragment: "Improvement Loop", nextPhase: "loop" },
	// /autopaper – topic intake → survey
	{ workflow: "autopaper", fragment: "Starting survey", nextPhase: "survey" },
	{ workflow: "autopaper", fragment: "Survey complete", nextPhase: "ideation" },
	{ workflow: "autopaper", fragment: "Idea selected", nextPhase: "autoresearch" },
	{ workflow: "autopaper", fragment: "Starting autoresearch", nextPhase: "autoresearch" },
	{ workflow: "autopaper", fragment: "Experiments complete", nextPhase: "lean" },
	{ workflow: "autopaper", fragment: "Starting paper writing", nextPhase: "writing" },
	{ workflow: "autopaper", fragment: "Paper draft complete", nextPhase: "review" },
	{ workflow: "autopaper", fragment: "Review complete", nextPhase: "done" },
];

// ============================================================================
// Required output files per workflow (checked at agent_end)
// ============================================================================

export interface RequiredOutputSpec {
	/** File extension or exact name to check for in the outputDir */
	pattern: "*.tex" | "*.bib" | "*.md" | "autoresearch.md" | "workflow-state.json";
	/** Human-readable description for the error message */
	description: string;
}

export const REQUIRED_OUTPUTS: Record<WorkflowName, RequiredOutputSpec[]> = {
	survey: [
		{ pattern: "*.tex", description: "LaTeX source file" },
		{ pattern: "*.bib", description: "BibTeX citations file" },
		{ pattern: "*.md", description: "Markdown summary" },
	],
	autoresearch: [
		{ pattern: "autoresearch.md", description: "AutoResearch configuration file" },
	],
	autopaper: [
		{ pattern: "*.tex", description: "Paper LaTeX source" },
		{ pattern: "*.md", description: "Summary or review report" },
	],
};

// ============================================================================
// Workflow detection from prompt text
// ============================================================================

/** Detect which workflow (if any) a prompt is invoking. */
export function detectWorkflow(prompt: string): WorkflowName | null {
	const lower = prompt.toLowerCase().trim();
	// The slash-command prompt text always starts with "You are running the ReAgent /X workflow"
	if (lower.includes("you are running the reagent /survey workflow")) return "survey";
	if (lower.includes("you are running the reagent /autoresearch workflow")) return "autoresearch";
	if (lower.includes("you are running the reagent /autopaper workflow")) return "autopaper";
	// Also catch user typing the command directly
	if (lower.startsWith("/survey")) return "survey";
	if (lower.startsWith("/autoresearch")) return "autoresearch";
	if (lower.startsWith("/autopaper")) return "autopaper";
	return null;
}

/** Get the initial phase for a workflow. */
export function initialPhase(workflow: WorkflowName): WorkflowPhase {
	switch (workflow) {
		case "survey": return "interview";
		case "autoresearch": return "setup";
		case "autopaper": return "intake";
	}
}

/** Ordered phase lists for status display. */
export const WORKFLOW_PHASES: Record<WorkflowName, WorkflowPhase[]> = {
	survey: ["interview", "research", "writing", "done"],
	autoresearch: ["setup", "baseline", "loop", "done"],
	autopaper: ["intake", "survey", "ideation", "autoresearch", "lean", "writing", "review", "done"],
};
