/**
 * Tool result wrapper for ReAgent workflows.
 * Ensures consistent structure for TUI rendering from all workflow tools.
 */

import type { AgentToolResult } from "@reagent/ra-agent-core";

export type WorkflowToolResult = AgentToolResult<WorkflowResultDetails>;

export interface WorkflowResultDetails {
	/** Human-readable label shown in the TUI */
	label: string;
	/** Short summary line (shown collapsed) */
	summary: string;
	/** Full content (shown expanded) */
	content?: string;
	/** Output file paths produced (if any) */
	outputPaths?: string[];
	/** Whether the operation succeeded */
	success: boolean;
	/** Error message if failed */
	error?: string;
	/** Structured data payload (workflow-specific) */
	data?: unknown;
}

/**
 * Create a successful tool result.
 */
export function successResult(
	label: string,
	summary: string,
	extra?: Pick<WorkflowResultDetails, "content" | "outputPaths" | "data">,
): WorkflowToolResult {
	return {
		text: summary,
		details: {
			label,
			summary,
			success: true,
			...extra,
		},
	};
}

/**
 * Create a failure tool result.
 */
export function failureResult(label: string, error: string, content?: string): WorkflowToolResult {
	return {
		text: `Error: ${error}`,
		details: {
			label,
			summary: `Failed: ${error}`,
			success: false,
			error,
			content,
		},
	};
}
