/**
 * ReAgent slash command registry
 *
 * Maps /survey, /review, /autoresearch, /autopaper to their system prompts.
 * These are registered as native slash commands via the ReAgent capability
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
	{
		name: "swarm",
		description: "Run a YAML-defined multi-agent pipeline (DAG orchestration with full tool access per agent)",
		prompt: `You are running the ReAgent /swarm command — multi-agent pipeline orchestration.

Ask the user for the path to a swarm YAML file, then use the swarm infrastructure to run it.

A swarm YAML looks like:
\`\`\`yaml
swarm:
  name: my-pipeline
  workspace: ./swarm-workspace
  mode: parallel  # or sequential, pipeline
  model: claude-sonnet-4-5  # optional default model
  agents:
    researcher:
      role: Research Analyst
      task: Search for papers about transformer architectures and summarize key findings in findings.md
    writer:
      role: Technical Writer
      waits_for: [researcher]
      task: Read findings.md and write a clear synthesis report in report.md
\`\`\`

Modes:
- **parallel**: all agents run simultaneously
- **sequential**: agents run one after another in declaration order  
- **pipeline**: repeated iterations with DAG dependency ordering

Each agent gets full tool access (bash, read, write, grep, fetch, web_search, browser).
Use \`waits_for\` to declare dependencies between agents.

Once you have the YAML path, parse and execute it using the swarm pipeline infrastructure.
Report progress and results when done.`.trim(),
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
	lines.push("\nAll standard tools are available (bash, read, write, grep, fetch, browser, exa, etc.).");
	return lines.join("\n");
}
