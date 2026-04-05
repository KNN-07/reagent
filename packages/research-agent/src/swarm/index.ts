/**
 * Swarm infrastructure — public surface.
 *
 * Re-exports everything needed to use the swarm DAG pipeline from other
 * research-agent modules or from the /swarm slash command handler.
 */
export { buildDependencyGraph, buildExecutionWaves, detectCycles } from "./dag";
export { PipelineController } from "./pipeline";
export type { PipelineOptions, PipelineProgress, PipelineResult } from "./pipeline";
export { renderSwarmProgress } from "./render";
export { parseSwarmYaml, validateSwarmDefinition } from "./schema";
export type { SwarmAgent, SwarmDefinition, SwarmMode } from "./schema";
export { StateTracker } from "./state";
export type { AgentState, AgentStatus, PipelineStatus, SwarmState } from "./state";
export { executeSwarmAgent } from "./executor";
export type { SwarmExecutorOptions } from "./executor";
