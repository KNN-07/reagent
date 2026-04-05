/**
 * ReAgent Workflow Guard Extension
 *
 * Enforces phase ordering for /survey, /autoresearch, and /autopaper workflows.
 *
 * Hooks used:
 *   before_agent_start – Detect which workflow started, initialise state.
 *   tool_call          – Block tools not allowed in the active phase.
 *   turn_end           – Detect phase-advance announcements in assistant messages.
 *   context            – Inject a phase-status banner into every LLM turn.
 *   agent_end          – Validate required output files; resume if missing.
 *   session_start / session_switch / session_branch / session_tree – Restore state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionContext, ExtensionFactory } from "@reagent/ra-coding-agent";
import { logger } from "@reagent/ra-utils";
import { detectPhaseTransition } from "./phase-detector";
import { validateWorkflowOutputs } from "./output-validator";
import {
	detectWorkflow,
	initialPhase,
	PHASE_BLOCKED_TOOLS,
	WORKFLOW_PHASES,
	type WorkflowName,
	type WorkflowPhase,
	type WorkflowState,
} from "./workflow-state";

// ============================================================================
// Constants
// ============================================================================

const CUSTOM_TYPE = "reagent_workflow";
const STATE_FILENAME = "workflow-state.json";

// ============================================================================
// In-memory state per session
// ============================================================================

/** Map of session ID → current workflow state (null = no active workflow) */
const sessionStates = new Map<string, WorkflowState | null>();

function getState(ctx: ExtensionContext): WorkflowState | null {
	return sessionStates.get(ctx.sessionManager.getSessionId()) ?? null;
}

function setState(ctx: ExtensionContext, state: WorkflowState | null): void {
	sessionStates.set(ctx.sessionManager.getSessionId(), state);
}

// ============================================================================
// Persistence helpers
// ============================================================================

/** Persist workflow state to the session (appendEntry) and optionally to disk. */
async function persistState(
	api: Parameters<ExtensionFactory>[0],
	ctx: ExtensionContext,
	state: WorkflowState,
): Promise<void> {
	// 1. In-session persistence (survives compaction via session entries)
	api.appendEntry<WorkflowState>(CUSTOM_TYPE, state);

	// 2. On-disk persistence in outputDir (if we know where it is)
	if (state.outputDir) {
		await writeDiskState(state);
	}
}

async function writeDiskState(state: WorkflowState): Promise<void> {
	if (!state.outputDir) return;
	try {
		await fs.mkdir(state.outputDir, { recursive: true });
		const filePath = path.join(state.outputDir, STATE_FILENAME);
		await Bun.write(filePath, JSON.stringify(state, null, 2));
	} catch (err) {
		logger.warn("workflow-guard: failed to write disk state", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Restore workflow state from session entries on session start/switch.
 * Reads the last `reagent_workflow` custom entry from the branch.
 */
function restoreStateFromSession(ctx: ExtensionContext): WorkflowState | null {
	const entries = ctx.sessionManager.getBranch();
	let last: WorkflowState | null = null;
	for (const entry of entries) {
		if (entry.type === "custom" && (entry as { customType?: string }).customType === CUSTOM_TYPE) {
			const data = (entry as { data?: WorkflowState }).data;
			if (data?.workflow && data?.phase) {
				last = data;
			}
		}
	}
	return last;
}

// ============================================================================
// Phase advancement
// ============================================================================

async function advancePhase(
	api: Parameters<ExtensionFactory>[0],
	ctx: ExtensionContext,
	state: WorkflowState,
	nextPhase: WorkflowPhase,
): Promise<void> {
	state.phase = nextPhase;
	state.updatedAt = Date.now();
	setState(ctx, state);
	await persistState(api, ctx, state);
	logger.debug("workflow-guard: phase advanced", {
		workflow: state.workflow,
		phase: nextPhase,
	});
	ctx.ui.setStatus("reagent_workflow", buildStatusText(state));
}

// ============================================================================
// Status banner
// ============================================================================

function buildStatusText(state: WorkflowState): string {
	const phases = WORKFLOW_PHASES[state.workflow];
	const remaining = phases.slice(phases.indexOf(state.phase) + 1);
	const remainingStr = remaining.length > 0 ? ` | Remaining: ${remaining.join(" → ")}` : "";
	return `[ReAgent] /${state.workflow} · phase: ${state.phase}${remainingStr}`;
}

function buildContextBanner(state: WorkflowState): string {
	const phases = WORKFLOW_PHASES[state.workflow];
	const remaining = phases.slice(phases.indexOf(state.phase) + 1);
	return [
		`> **[ReAgent Workflow Guard]** Active workflow: \`/${state.workflow}\` | Phase: \`${state.phase}\``,
		remaining.length > 0 ? `> Remaining phases: ${remaining.map(p => `\`${p}\``).join(" → ")}` : "> All phases complete.",
	].join("\n");
}

// ============================================================================
// The extension factory
// ============================================================================

export const createWorkflowGuardExtension: ExtensionFactory = api => {
	// ----------------------------------------------------------------
	// Session lifecycle – restore state on reload
	// ----------------------------------------------------------------
	const rehydrate = (_event: unknown, ctx: ExtensionContext): void => {
		const restored = restoreStateFromSession(ctx);
		setState(ctx, restored);
		if (restored) {
			ctx.ui.setStatus("reagent_workflow", buildStatusText(restored));
			logger.debug("workflow-guard: restored state from session", {
				workflow: restored.workflow,
				phase: restored.phase,
			});
		} else {
			ctx.ui.setStatus("reagent_workflow", undefined);
		}
	};

	api.on("session_start", rehydrate);
	api.on("session_switch", rehydrate);
	api.on("session_branch", rehydrate);
	api.on("session_tree", rehydrate);

	api.on("session_shutdown", (_event, ctx) => {
		sessionStates.delete(ctx.sessionManager.getSessionId());
	});

	// ----------------------------------------------------------------
	// before_agent_start – detect which workflow is being invoked
	// ----------------------------------------------------------------
	api.on("before_agent_start", async (event, ctx) => {
		const workflow = detectWorkflow(event.prompt);
		if (!workflow) return;

		// Only initialise if there's no active workflow, or if it's a new invocation
		// (workflow changed or prompt explicitly names a new command)
		const existing = getState(ctx);
		if (existing && existing.workflow === workflow && existing.phase !== "done") {
			// Same workflow still in progress — don't reset
			return;
		}

		const now = Date.now();
		const state: WorkflowState = {
			workflow,
			phase: initialPhase(workflow),
			startedAt: now,
			updatedAt: now,
		};

		setState(ctx, state);
		await persistState(api, ctx, state);
		ctx.ui.setStatus("reagent_workflow", buildStatusText(state));

		logger.debug("workflow-guard: workflow started", {
			workflow,
			phase: state.phase,
		});
	});

	// ----------------------------------------------------------------
	// tool_call – block tools not allowed in the active phase
	// ----------------------------------------------------------------
	api.on("tool_call", (event, ctx) => {
		const state = getState(ctx);
		if (!state || state.phase === "done") return;

		const blocked = PHASE_BLOCKED_TOOLS[state.workflow]?.[state.phase];
		if (!blocked || blocked.size === 0) return;

		if (blocked.has(event.toolName)) {
			const reason = buildBlockReason(event.toolName, state);
			logger.debug("workflow-guard: blocked tool call", {
				tool: event.toolName,
				workflow: state.workflow,
				phase: state.phase,
			});
			return { block: true, reason };
		}
	});

	function buildBlockReason(toolName: string, state: WorkflowState): string {
		const phases = WORKFLOW_PHASES[state.workflow];
		const currentIdx = phases.indexOf(state.phase);
		const next = phases[currentIdx + 1];
		return (
			`[ReAgent Workflow Guard] \`${toolName}\` is not allowed in the ` +
			`\`${state.phase}\` phase of \`/${state.workflow}\`. ` +
			(next
				? `Wait for the phase to advance to \`${next}\` before using this tool. ` +
				  `To advance, announce the appropriate transition phrase (e.g. "Starting research phase...").`
				: "The current phase does not permit this tool.")
		);
	}

	// ----------------------------------------------------------------
	// turn_end – detect phase-advance announcements in assistant messages
	// ----------------------------------------------------------------
	api.on("turn_end", async (event, ctx) => {
		const state = getState(ctx);
		if (!state || state.phase === "done") return;

		const nextPhase = detectPhaseTransition(event.message, state.workflow, state.phase);
		if (nextPhase) {
			await advancePhase(api, ctx, state, nextPhase);
		}

		// Try to extract outputDir from write tool results if not yet known
		if (!state.outputDir && event.toolResults.length > 0) {
			for (const toolResult of event.toolResults) {
				const outputDir = inferOutputDir(toolResult, state.workflow, ctx.cwd);
				if (outputDir) {
					state.outputDir = outputDir;
					state.updatedAt = Date.now();
					setState(ctx, state);
					await persistState(api, ctx, state);
					break;
				}
			}
		}
	});

	/**
	 * Infer the workflow output directory from a write tool result.
	 * Looks for paths matching known output patterns (surveys/, papers/, experiments/).
	 */
	function inferOutputDir(
		toolResult: { content?: unknown },
		workflow: WorkflowName,
		cwd: string,
	): string | undefined {
		const content = toolResult.content;
		if (!Array.isArray(content)) return undefined;
		for (const part of content) {
			if (typeof part !== "object" || !part || !("text" in part)) continue;
			const text = String((part as { text: unknown }).text);
			const patterns: Record<WorkflowName, RegExp> = {
				survey: /surveys\/[^\s"']+/,
				autoresearch: /experiments\/[^\s"']+/,
				autopaper: /papers\/[^\s"']+/,
			};
			const match = text.match(patterns[workflow]);
			if (match) {
				return path.isAbsolute(match[0]) ? match[0] : path.join(cwd, match[0]);
			}
		}
		return undefined;
	}

	// ----------------------------------------------------------------
	// context – inject phase-status banner into every LLM turn
	// ----------------------------------------------------------------
	api.on("context", (event, ctx) => {
		const state = getState(ctx);
		if (!state || state.phase === "done") return;

		const banner = buildContextBanner(state);
		const bannerMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: banner }],
			timestamp: Date.now(),
		};

		// Inject as the very last user message before the next assistant turn
		// so the model always sees the current phase at the top of its context
		return { messages: [...event.messages, bannerMessage] };
	});

	// ----------------------------------------------------------------
	// agent_end – validate required outputs; trigger resume if missing
	// ----------------------------------------------------------------
	api.on("agent_end", async (_event, ctx) => {
		const state = getState(ctx);
		if (!state || state.phase === "done") return;

		// Only validate for terminal phases (writing for survey/autopaper, loop for autoresearch)
		const terminalPhases: Record<WorkflowName, WorkflowPhase> = {
			survey: "writing",
			autoresearch: "loop",
			autopaper: "writing",
		};
		if (state.phase !== terminalPhases[state.workflow]) return;
		if (ctx.hasPendingMessages()) return;

		const { missing } = await validateWorkflowOutputs(state.workflow, state.outputDir);
		if (missing.length === 0) {
			// Mark done
			await advancePhase(api, ctx, state, "done");
			ctx.ui.setStatus("reagent_workflow", undefined);
			return;
		}

		logger.warn("workflow-guard: required outputs missing", { missing });

		const missingList = missing.map(m => `- ${m}`).join("\n");
		api.sendMessage(
			{
				customType: CUSTOM_TYPE,
				content: [
					{
						type: "text",
						text: [
							`[ReAgent Workflow Guard] The \`/${state.workflow}\` workflow is not yet complete.`,
							`The following required output files are missing:`,
							missingList,
							`Please complete the current phase (\`${state.phase}\`) before finishing.`,
						].join("\n"),
					},
				],
				display: true,
				attribution: "agent",
			},
			{ triggerTurn: true },
		);
	});
};

// Default export for file-based extension loading (module.default is preferred by the extension loader)
export default createWorkflowGuardExtension;
