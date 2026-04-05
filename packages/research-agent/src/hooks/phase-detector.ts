/**
 * Workflow guard – phase transition detector.
 *
 * Pure functions that inspect assistant message text to determine whether
 * a phase transition should occur. No side effects; testable in isolation.
 */

import type { AgentMessage } from "@reagent/ra-agent-core";
import { PHASE_TRIGGERS, type PhaseTrigger, type WorkflowName, type WorkflowPhase } from "./workflow-state";

/**
 * Extract all text content from an AssistantMessage.
 * Returns empty string for any non-assistant message type — only the
 * assistant can make phase-transition announcements.
 */
export function extractMessageText(message: AgentMessage): string {
	// AgentMessage is a discriminated union; only 'assistant' messages have
	// a `content` array that can contain text blocks. We narrow here to
	// avoid touching roles like 'bashExecution', 'custom', 'toolResult', etc.
	if (message.role !== "assistant") return "";

	const content = (message as { role: "assistant"; content: unknown }).content;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return (content as Array<{ type: string; text?: string }>)
			.filter(c => c.type === "text" && typeof c.text === "string")
			.map(c => c.text as string)
			.join(" ");
	}
	return "";
}

/**
 * Find the first phase trigger that matches the message text for the active workflow.
 * Returns the trigger if found, otherwise null.
 */
export function findPhaseTrigger(
	text: string,
	activeWorkflow: WorkflowName,
): PhaseTrigger | null {
	for (const trigger of PHASE_TRIGGERS) {
		if (trigger.workflow !== activeWorkflow) continue;
		if (text.includes(trigger.fragment)) {
			return trigger;
		}
	}
	return null;
}

/**
 * Check whether a given assistant message advances the phase for the active workflow.
 * Returns the next phase if a transition is detected, otherwise null.
 */
export function detectPhaseTransition(
	message: AgentMessage,
	activeWorkflow: WorkflowName,
	currentPhase: WorkflowPhase,
): WorkflowPhase | null {
	if (message.role !== "assistant") return null;
	const text = extractMessageText(message);
	const trigger = findPhaseTrigger(text, activeWorkflow);
	if (!trigger) return null;
	// Don't transition to the same phase
	if (trigger.nextPhase === currentPhase) return null;
	return trigger.nextPhase;
}
