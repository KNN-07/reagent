/**
 * Workflow guard – output validator.
 *
 * Checks that required output files exist in the workflow's output directory
 * after the agent finishes. Returns a list of missing file descriptions.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { REQUIRED_OUTPUTS, type WorkflowName } from "./workflow-state";

interface ValidationResult {
	/** Missing file descriptions, empty if all requirements are met */
	missing: string[];
}

/**
 * Validate that all required output files exist for the completed workflow.
 * Returns an empty `missing` array if everything is present or if the
 * outputDir is not yet known (can't validate what we can't find).
 */
export async function validateWorkflowOutputs(
	workflow: WorkflowName,
	outputDir: string | undefined,
): Promise<ValidationResult> {
	if (!outputDir) return { missing: [] };

	const specs = REQUIRED_OUTPUTS[workflow];
	if (!specs || specs.length === 0) return { missing: [] };

	// Read directory contents once
	let entries: string[];
	try {
		entries = await fs.readdir(outputDir);
	} catch {
		// Output dir doesn't exist yet — nothing to validate
		return { missing: [] };
	}

	const missing: string[] = [];

	for (const spec of specs) {
		const { pattern, description } = spec;

		if (pattern.startsWith("*")) {
			// Glob-style: check if any file matches the extension
			const ext = pattern.slice(1); // e.g. ".tex"
			const found = entries.some(name => name.endsWith(ext));
			if (!found) {
				missing.push(`${description} (${pattern}) in ${outputDir}`);
			}
		} else {
			// Exact filename match
			const found = entries.includes(pattern);
			if (!found) {
				// Also check if it exists at CWD level (autoresearch.md lives at project root)
				const cwdMatch = await fileExists(path.join(path.dirname(outputDir), pattern));
				if (!cwdMatch) {
					missing.push(`${description} (${pattern})`);
				}
			}
		}
	}

	return { missing };
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
