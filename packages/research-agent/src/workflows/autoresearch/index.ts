/**
 * /autoresearch workflow — automated ML experimentation loop
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export const AUTORESEARCH_CONFIG_FILE = "autoresearch.md";

export interface AutoresearchConfig {
benchmarkCommand: string;
targetMetric?: string;
maxIterations?: number;
cwd: string;
}

export interface IterationResult {
iteration: number;
output: string;
metric: string;
change: string;
}

export interface AutoresearchState {
config: AutoresearchConfig;
iterations: IterationResult[];
bestMetric: string;
done: boolean;
}

export async function findAutoresearchConfig(cwd: string): Promise<string | null> {
	const candidate = path.join(cwd, AUTORESEARCH_CONFIG_FILE);
	try {
		await fs.access(candidate);
		return candidate;
	} catch {
		return null;
	}
}

export async function readAutoresearchConfig(configPath: string): Promise<string> {
return await fs.readFile(configPath, "utf-8");
}

export const AUTORESEARCH_SLASH_COMMAND_PROMPT = `
You are running the ReAgent /autoresearch workflow — automated ML experimentation loop.

## Overview
AutoResearch automates the "idea → implement → run → analyse → improve" cycle for ML experiments.

## Step 1: Setup
Check for autoresearch.md in the working directory.

If it exists, read it and confirm:
- The benchmark command
- The metric being optimised
- Current baseline performance

If it does NOT exist, help the user create one:

\`\`\`markdown
# AutoResearch Config

## Benchmark Command
\`\`\`bash
python train.py --dataset cifar10 --epochs 10
\`\`\`

## Metric
Validation accuracy (higher is better). Target: >= 0.95

## Current Baseline
0.87 accuracy with default hyperparameters.

## Constraints
- Max 1 hour per run
- GPU memory <= 24 GB
- No external APIs
\`\`\`
\`\`\`

## Step 2: Run Baseline
Execute the benchmark command and record the output metric.

## Step 3: Improvement Loop
For each iteration:
1. **Analyse** the current results — what is the bottleneck?
2. **Propose** a concrete, testable change (hyperparameter, architecture, data augmentation, etc.)
3. **Implement** the change (edit source files with write/patch tools)
4. **Run** the benchmark command
5. **Compare** before vs after — did it improve?
6. If improved: keep the change, update the baseline
7. If not: revert the change, try a different direction

## Step 4: Stopping Criteria
Stop when one of these is true:
- Target metric is reached
- User says stop
- maxIterations reached (default: 10)
- No improvement in last 3 iterations

## Step 5: Report
Summarise:
- Starting metric vs. final metric
- All changes made (what worked, what did not)
- Recommended next steps

Keep all experiment logs in ./experiments/<slug>-<date>/
`.trim();
