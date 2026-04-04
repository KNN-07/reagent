/**
 * ReAgent slash command registry
 *
 * Maps /survey, /review, /autoresearch, /autopaper to their system prompts.
 * These are registered as FileSlashCommands via the oh-my-pi extensibility
 * system when the agent session starts.
 */

import { SURVEY_SLASH_COMMAND_PROMPT } from "./workflows/survey/index";
import { REVIEW_SLASH_COMMAND_PROMPT } from "./workflows/review/index";
import { AUTORESEARCH_SLASH_COMMAND_PROMPT } from "./workflows/autoresearch/index";
import { AUTOPAPER_SLASH_COMMAND_PROMPT } from "./workflows/autopaper/index";

export interface SlashCommandDef {
	name: string;
	description: string;
	/** System prompt injected when the command is invoked */
	prompt: string;
}

export const REAGENT_SLASH_COMMANDS: SlashCommandDef[] = [
	{
		name: "survey",
		description: "Deep research survey — generates LaTeX paper + PDF with verified citations",
		prompt: SURVEY_SLASH_COMMAND_PROMPT,
	},
	{
		name: "review",
		description: "Simulated peer review with 3 reviewer personas (methods, writing, impact)",
		prompt: REVIEW_SLASH_COMMAND_PROMPT,
	},
	{
		name: "autoresearch",
		description: "Automated ML experimentation loop — idea → run → compare → improve",
		prompt: AUTORESEARCH_SLASH_COMMAND_PROMPT,
	},
	{
		name: "autopaper",
		description: "End-to-end paper pipeline: survey → autoresearch → Lean verify → write → review",
		prompt: AUTOPAPER_SLASH_COMMAND_PROMPT,
	},
];

/**
 * Get a command definition by name.
 */
export function getSlashCommand(name: string): SlashCommandDef | undefined {
	return REAGENT_SLASH_COMMANDS.find((cmd) => cmd.name === name.replace(/^\//, ""));
}

/**
 * Build help text listing all available slash commands.
 */
export function buildSlashCommandHelp(): string {
	const lines = ["## ReAgent Research Commands\n"];
	for (const cmd of REAGENT_SLASH_COMMANDS) {
		lines.push(`  **/${cmd.name}** — ${cmd.description}`);
	}
	lines.push("\nAll oh-my-pi tools are available (bash, read, write, grep, fetch, browser, exa, etc.).");
	return lines.join("\n");
}
