#!/usr/bin/env bun
/**
 * ReAgent CLI — AI/ML Research Agent Harness
 *
 * Extends oh-my-pi's coding agent with research-specific workflows:
 *   /survey       — deep paper survey with LaTeX + PDF output
 *   /review       — simulated multi-model peer review
 *   /autoresearch — automated ML experimentation loop
 *   /autopaper    — end-to-end paper generation pipeline
 */

import * as os from "node:os";
import * as path from "node:path";
import { logger, VERSION as OMP_VERSION } from "@reagent/ra-utils";
import { runRootCommand } from "@reagent/ra-coding-agent";
import { parseArgs } from "@reagent/ra-coding-agent/cli/args";
import { checkDependencies } from "./tools/dependency-check";
import { REAGENT_VERSION } from "./version";
// Side-effect: registers /survey, /review, /autoresearch, /autopaper as a native
// capability provider so they appear in the TUI before the session loads.
import "./provider";

async function main(): Promise<void> {
	const rawArgs = process.argv.slice(2);

	// Check and warn about optional external dependencies (Lean, LaTeX)
	// Non-blocking — only emits warnings, doesn't exit.
	void checkDependencies();

	// Pass through to oh-my-pi's root command handler.
	// ReAgent's slash commands (/survey, /review, /autoresearch, /autopaper)
	// are registered as custom slash commands via the extension system,
	// loaded from src/workflows/*/slash-command.ts at session startup.
	const parsed = parseArgs(rawArgs);
	await runRootCommand(parsed, rawArgs);
}

main().catch((error: unknown) => {
	const msg = error instanceof Error ? error.message : String(error);
	process.stderr.write(`\nreagent: fatal error: ${msg}\n`);
	process.exit(1);
});
