/**
 * Custom tool loader for ReAgent.
 *
 * Scans ~/.reagent/tools/ and .reagent/tools/ (project-local) for *.ts files
 * that export a default CustomTool or CustomTool[]. Loads and registers them
 * into the agent session's tool registry at startup.
 *
 * This mirrors the ra-coding-agent's extensibility system but scoped to ReAgent's
 * config directory (.reagent instead of .reagent via PI_CONFIG_DIR).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CustomTool } from "@reagent/ra-coding-agent/extensibility/custom-tools";
import { logger } from "@reagent/ra-utils";
import { CONFIG_DIR } from "../version";

export interface LoadedCustomTools {
	tools: CustomTool[];
	errors: string[];
}

/**
 * Discover tool files from both global (~/.reagent/tools/) and project-local
 * (.reagent/tools/) directories.
 */
async function discoverToolFiles(cwd: string): Promise<string[]> {
	const globalToolsDir = path.join(os.homedir(), CONFIG_DIR, "tools");
	const projectToolsDir = path.join(cwd, `.${CONFIG_DIR}`, "tools");

	const files: string[] = [];

	for (const dir of [globalToolsDir, projectToolsDir]) {
		try {
			const entries = await fs.readdir(dir);
			for (const entry of entries) {
				if (entry.endsWith(".ts") || entry.endsWith(".js")) {
					files.push(path.join(dir, entry));
				}
			}
		} catch {
			// Directory doesn't exist — not an error.
		}
	}

	return files;
}

/**
 * Load all custom tools from the tool directories.
 * Files that fail to load are recorded in `errors` but don't abort loading.
 */
export async function loadCustomTools(cwd: string): Promise<LoadedCustomTools> {
	const toolFiles = await discoverToolFiles(cwd);
	const tools: CustomTool[] = [];
	const errors: string[] = [];

	for (const file of toolFiles) {
		try {
			// Bun handles TypeScript natively — no compilation step needed.
			const mod = await import(file) as { default?: CustomTool | CustomTool[] };
			const exported = mod.default;

			if (!exported) {
				errors.push(`${file}: no default export`);
				continue;
			}

			if (Array.isArray(exported)) {
				tools.push(...exported);
				logger.debug(`Loaded ${exported.length} custom tools from ${file}`);
			} else {
				tools.push(exported);
				logger.debug(`Loaded custom tool "${exported.name}" from ${file}`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${file}: ${msg}`);
			logger.warn(`Failed to load custom tool file`, { file, error: msg });
		}
	}

	return { tools, errors };
}
