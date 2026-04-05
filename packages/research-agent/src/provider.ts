/**
 * ReAgent native capability provider
 *
 * Registers /survey, /review, /autoresearch, and /autopaper as a native
 * slash-command provider so they appear in the TUI autocomplete/dropdown
 * without requiring markdown files on disk.
 *
 * Import this module once (as a side-effect) before `runRootCommand` is called.
 * The `registerProvider` call runs at module load time, and `loadSlashCommands`
 * inside InteractiveMode.init() will pick them up automatically.
 */

import { registerProvider, slashCommandCapability } from "@reagent/ra-coding-agent";
import type { LoadContext, LoadResult, SourceMeta, CapabilitySlashCommand } from "@reagent/ra-coding-agent";
import { REAGENT_SLASH_COMMANDS } from "./slash-commands";

const PROVIDER_ID = "reagent";
const DISPLAY_NAME = "ReAgent";
const DESCRIPTION = "ReAgent research workflow commands (/survey, /review, /autoresearch, /autopaper)";

/**
 * Build a synthetic SourceMeta for a native in-memory command.
 * The path is a virtual URI (never read from disk).
 */
function makeSourceMeta(commandName: string): SourceMeta {
	return {
		provider: PROVIDER_ID,
		providerName: DISPLAY_NAME,
		path: `reagent://${commandName}`,
		level: "native",
	};
}

async function loadReagentCommands(_ctx: LoadContext): Promise<LoadResult<CapabilitySlashCommand>> {
	const items: CapabilitySlashCommand[] = REAGENT_SLASH_COMMANDS.map((cmd) => ({
		name: cmd.name,
		path: `reagent://${cmd.name}`, // virtual path — never read from disk
		content: cmd.prompt,
		level: "native" as const,
		_source: makeSourceMeta(cmd.name),
	}));

	return { items };
}

registerProvider<CapabilitySlashCommand>(slashCommandCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: DESCRIPTION,
	// Priority 90 — lower than native (100) so the user can override with their own
	// .omp/commands/survey.md, but higher than tool-specific providers (50-99 overlap).
	priority: 90,
	load: loadReagentCommands,
});
