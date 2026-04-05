/**
 * ReAgent — public API surface
 *
 * Exports the session configuration, slash commands, memory/context
 * infrastructure, and all workflow entry points.
 */

// Version
export * from "./version";

// Workflows
export * from "./workflows/survey/index";
export * from "./workflows/survey/types";
export * from "./workflows/review/index";
export * from "./workflows/autoresearch/index";
export * from "./workflows/autopaper/index";
export * from "./workflows/autopaper/lean-verifier";

// Infrastructure
export * from "./context/CompactionService";
export * from "./memory/KairosMemory";
export * from "./extensibility/custom-tools/loader";
export * from "./slash-commands";

// Swarm / multi-agent pipeline orchestration
export * from "./swarm/index";

// Tools
export * from "./tools/submit-result";
export * from "./tools/dependency-check";

// System prompt (loaded as text for injection)
import systemPrompt from "./prompts/system.md" with { type: "text" };
export { systemPrompt };
