# ReAgent: AI/ML Research Agent Harness

## Overview

ReAgent is a custom agent harness for AI/ML research support, built as a new package inside the `d:\Repos\ReAgent\` workspace. It extends **oh-my-pi** (the primary source of tools, agent runtime, and autoresearch logic) with research-specific workflows, and borrows **memory/context management** approaches from both oh-my-pi's Kairos memory system and Claude Code's `memdir`/context-compaction architecture.

It is NOT a fork — it's a standalone package (`reagent/`) that imports from oh-my-pi's published packages as library dependencies.

---

## User Review Required

> [!IMPORTANT]
> **Technology stack choice**: oh-my-pi uses **Bun** as the runtime with TypeScript. pi-mono uses **Node + npm**. ReAgent will follow oh-my-pi's conventions (Bun) since that's the richer source for tools and the autoresearch module. Do you want this to be a Bun-first project like oh-my-pi, or Node-based like pi-mono?

> [!IMPORTANT]
> **Package relationship**: Should ReAgent import oh-my-pi packages via local path references (monorepo-style `"workspace:*"`) or from npm (assuming oh-my-pi publishes to npm as `@oh-my-pi/*`)? The oh-my-pi packages under `d:\Repos\ReAgent\oh-my-pi\packages\` each have their own `package.json` with scoped names like `@oh-my-pi/pi-coding-agent`.

> [!CAUTION]
> **Lean vs. LaTeX toolchain**: The `/autoresearch` → `/autopaper` pipeline requires Lean 4 for math proof verification and a LaTeX compiler (e.g., `tectonic` or `pdflatex`) for PDF generation. These are external CLI dependencies. Should ReAgent bundle/manage them or assume they are pre-installed on the system PATH?

> [!WARNING]
> **LLM API Keys needed**: The survey, review, and autoresearch pipelines will call multiple different LLM providers with different models (e.g., best model for autopaper, smaller/cheaper for review agents). The existing oh-my-pi `AuthStorage` handles multi-provider key management. ReAgent will reuse this. Users need at minimum: `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY` / `OPENAI_API_KEY`).

---

## Architecture

ReAgent is structured as a **Bun monorepo** at `d:\Repos\ReAgent\reagent\` with these packages:

```
reagent/
├── package.json          (workspace root)
├── packages/
│   └── research-agent/   (main CLI package)
│       ├── package.json
│       ├── src/
│       │   ├── cli.ts               (entry point, slash-command router)
│       │   ├── context/
│       │   │   ├── CompactionService.ts  (Claude Code-style context compaction)
│       │   │   └── MemoryManager.ts     (MEMORY.md system from Claude Code)
│       │   ├── memory/
│       │   │   └── KairosMemory.ts      (oh-my-pi style background consolidation)
│       │   ├── tools/
│       │   │   └── submit-result.ts     (tool result wrapper)
│       │   ├── workflows/
│       │   │   ├── survey/              (/survey workflow)
│       │   │   │   ├── index.ts
│       │   │   │   ├── interviewer.ts   (interview + context gathering)
│       │   │   │   ├── researcher.ts    (deep search + source validation)
│       │   │   │   ├── writer.ts        (LaTeX + MD output generation)
│       │   │   │   └── prompts/
│       │   │   ├── review/              (/review workflow)
│       │   │   │   ├── index.ts
│       │   │   │   ├── subagents.ts     (multi-model peer review)
│       │   │   │   └── prompts/
│       │   │   ├── autoresearch/        (/autoresearch workflow - wraps oh-my-pi)
│       │   │   │   ├── index.ts
│       │   │   │   └── adapter.ts       (adapts oh-my-pi autoresearch types)
│       │   │   └── autopaper/           (/autopaper workflow)
│       │   │       ├── index.ts
│       │   │       ├── orchestrator.ts  (coordinates survey+autoresearch+review)
│       │   │       ├── lean-verifier.ts (Lean 4 math proof verification)
│       │   │       └── prompts/
│       │   └── extensibility/
│       │       └── custom-tools/
│       │           └── loader.ts        (custom tool loader)
│       └── tsconfig.json
```

---

## Proposed Changes

### New Package: `reagent/`

#### [NEW] reagent/package.json
Root workspace manifest with bun workspaces. Declares the `research-agent` workspace.

---

#### [NEW] reagent/packages/research-agent/package.json
Declares dependencies on:
- `@oh-my-pi/pi-coding-agent` — agent runtime, session management, TUI, slash-command system, autoresearch module, exa research tools
- `@oh-my-pi/pi-ai` — multi-provider LLM streaming
- `@oh-my-pi/pi-agent-core` — tool call protocol
- `@oh-my-pi/pi-tui` — TUI rendering components
- `@oh-my-pi/pi-utils` — logger, memory paths, etc.
- `@sinclair/typebox` — tool schema definitions

---

#### [NEW] src/cli.ts — Entry Point & Slash-Command Router
The main Bun entry. Extends oh-my-pi's `runRootCommand` with ReAgent-specific slash commands: `/survey`, `/review`, `/autoresearch`, `/autopaper`.

Startup flow:
1. Parse CLI args (extends oh-my-pi's `Args`)
2. Detect slash-command prefix in initial message
3. Route to the appropriate workflow module
4. Fall back to oh-my-pi interactive mode for everything else

---

#### [NEW] src/context/CompactionService.ts — Context Compaction
Adapted from Claude Code's context compaction logic. Monitors token usage during long research sessions and triggers background summarization when approaching context limits.

Key behaviors:
- Watch `tokenUsage` events from the agent session
- Trigger compaction when usage > configurable threshold (default: 80% of model context)
- Use a smaller/faster model role (`smol`) for compaction summaries
- Inject compact summary back as a system context message

---

#### [NEW] src/memory/KairosMemory.ts — Background Memory Consolidation
Adapted from oh-my-pi's `packages/coding-agent/src/memories/index.ts`. Provides:
- **Phase 1**: Per-session rollout extraction — scan JSONL session logs, extract memorable facts using a small model
- **Phase 2**: Global consolidation — merge raw memories into a `MEMORY.md` index + topic files + skills
- Research-specific memory types: `paper_citation`, `research_finding`, `experiment_result`, `survey_topic`

Stored at: `~/.reagent/memory/<project-slug>/`

---

#### [NEW] src/workflows/survey/ — `/survey` Workflow

**Flow:**
1. **Interview** (`interviewer.ts`): Ask user structured questions:
   - What topic / keywords?
   - Time range for papers? (e.g., 2020–present)
   - Specific venues / conferences / journals to focus on?
   - Related context files to attach?
   - Output format preferences?
   Confirm understanding before proceeding.

2. **Research** (`researcher.ts`):
   - Use exa `exa_researcher_start` + `exa_researcher_poll` for deep async research
   - Also use oh-my-pi's `fetch` tool and `browser` tool for source validation
   - Source legitimacy check: verify each citation against known academic databases (arXiv, Semantic Scholar, ACL Anthology, IEEE, Springer, Nature)
   - Deduplicate and rank sources by relevance + trust score
   - Extract structured citation data (BibTeX format)

3. **Write** (`writer.ts`):
   - Generate **LaTeX survey source** (IEEE or ACL template by default)
   - Compile to **PDF** using `tectonic` or system `pdflatex`
   - Generate **Markdown summary** for quick reading
   - Re-check citations: run BibTeX validation, verify DOIs resolve, flag unresolvable refs
   - Output to `./surveys/<topic-slug>/` in working directory

**Prompt files**: `prompts/interview.md`, `prompts/researcher.md`, `prompts/writer.md`

---

#### [NEW] src/workflows/review/ — `/review` Workflow

**Flow:**
1. Accept: paper text (PDF/LaTeX/MD), target conference/journal (optional)
2. Load conference-specific review rubric from `prompts/rubrics/<venue>.md`
3. Spawn N parallel **sub-agent review instances** (configurable, default 3):
   - Each uses a different model (e.g., Claude Sonnet, Gemini Flash, GPT-4o)
   - Each has a different reviewer persona system prompt (Reviewer A: methods expert, Reviewer B: writing quality, Reviewer C: related work coverage)
4. Aggregate reviews into a unified report with:
   - Scores per criterion
   - Consensus strengths / weaknesses
   - Suggested revisions
   - Meta-review (area chair perspective)

**Prompt files**: `prompts/reviewer-persona-*.md`, `prompts/rubrics/`, `prompts/meta-review.md`

---

#### [NEW] src/workflows/autoresearch/ — `/autoresearch` Workflow

This is primarily an **adapter** around oh-my-pi's existing autoresearch module (`packages/coding-agent/src/autoresearch/`), which is already fully featured. ReAgent adds:
- Simplified CLI entry (`/autoresearch` slash command)
- Research-domain configuration presets (ML benchmarks, paper evaluation metrics)
- Integration with the memory system (auto-log experiment results to KairosMemory)
- Dashboard output to terminal

**Flow** (inherits from oh-my-pi):
1. Read `autoresearch.md` contract (benchmark command, primary metric, direction)
2. `init_experiment` → set up experiment state
3. Loop: `run_experiment` → analyze results → apply code changes → `run_experiment`
4. Auto-resume on crash, track history

---

#### [NEW] src/workflows/autopaper/ — `/autopaper` Workflow

**Flow (orchestrated by `orchestrator.ts`):**
1. User provides topic/idea
2. Check `./surveys/` for existing survey results:
   - If found: list available surveys → user picks one OR starts fresh
   - If not found: run `/survey` workflow automatically
3. Present improvement ideas to user (generated by agent), user selects focus
4. Run `/autoresearch` on the selected idea:
   - Ask user for more details or implementation choices
   - Configure `autoresearch.md` contract
   - Run experiment loop
5. **Math proof** (`lean-verifier.ts`):
   - Extract mathematical claims from experiment results
   - Generate Lean 4 proof sketches
   - Run `lean` CLI to verify
   - If verification fails, feed error back to agent for revision
6. **Synthesis** (`writer.ts`): Generate LaTeX paper:
   - Combine survey background, experiment results, math proofs
   - Use high-intelligence model (Claude Opus / Gemini 2.0 Ultra) for writing
   - Follow NeurIPS / ICML / ICLR style by default
7. Run `/review` workflow on the draft
8. Iterate if reviewer scores below threshold

---

#### [NEW] src/extensibility/custom-tools/loader.ts — Custom Tool Loader
Mirrors oh-my-pi's extensibility system. Allows users to drop `.ts` files into `.reagent/tools/` and have them auto-loaded as custom tools available to all workflows.

---

#### [NEW] src/tools/submit-result.ts — Tool Result Wrapper
Standard result wrapper for all workflow tool outputs, ensuring consistent structure for TUI rendering.

---

## Integration with oh-my-pi Tools

ReAgent inherits **all** oh-my-pi built-in tools by composing `createAgentSession` from `@oh-my-pi/pi-coding-agent`. This includes:

| Tool | Module |
|------|--------|
| `bash` | `src/tools/bash.ts` |
| `read`, `write`, `grep`, `find` | file tools |
| `fetch`, `browser` | web tools |
| `exa_search`, `exa_researcher_start/poll` | Exa research tools |
| `python`, `notebook` | execution tools |
| `gh` | GitHub CLI integration |
| `ask` | sub-agent delegation |
| `autoresearch` suite | autoresearch tools |

---

## Memory & Context Architecture

```
Session Layer (in-process)
  └── CompactionService (watches token budget → triggers summary injection)
  
Persistence Layer (~/.reagent/)
  └── KairosMemory
       ├── Phase 1: per-session rollout extraction (background, after each session)
       └── Phase 2: global consolidation (MEMORY.md + topic files + skills)
       
Working Directory Layer (./surveys/, ./autoresearch/, ./papers/)
  └── Structured output artifacts (LaTeX, PDFs, BibTeX, experiment logs)
```

---

## Open Questions

> [!IMPORTANT]
> **1. Package resolution**: Do you want to use local path references to the oh-my-pi packages in this repo (e.g., `"@oh-my-pi/pi-coding-agent": "file:../../oh-my-pi/packages/coding-agent"`), or install from npm? Local refs are simpler for development but couple the projects.

> [!IMPORTANT]
> **2. LLM provider for survey source validation**: Exa's researcher tool does deep research, but source legitimacy checking (is this a real paper from a credible venue?) may need additional logic. Should this use a separate model call per citation, or a batch validation pass?

> [!IMPORTANT]
> **3. Lean 4 scope**: Lean verification is complex and may fail for non-trivial claims. Should the Lean step be **optional** (skip if the user doesn't have Lean installed or claims are too complex) or **required** for `/autopaper`?

> [!NOTE]
> **4. LaTeX compiler**: `tectonic` is a self-contained LaTeX engine (no TeX Live installation needed). Alternatively, the agent can output only the `.tex` source and let the user compile. Which do you prefer?

> [!NOTE]
> **5. Subagent models for /review**: The review workflow needs access to multiple providers. Should it default to using the same provider but different models (e.g., `claude-sonnet-4-5`, `claude-opus-4`), or explicitly require multi-provider setup?

---

## Verification Plan

### Automated Tests
- Unit tests for `CompactionService` token threshold logic
- Unit tests for `KairosMemory` phase 1/2 pipeline (using mock sessions)
- Unit tests for BibTeX citation validation in survey writer
- Integration test: `/survey` dry-run with mock Exa responses
- Integration test: `/review` with a sample paper

```bash
# Run tests
bun test packages/research-agent/test/
```

### Manual Verification
- Run `bun run reagent /survey` with a real AI topic and verify LaTeX output
- Run `bun run reagent /autoresearch` on a sample ML benchmark
- Verify memory consolidation creates expected `MEMORY.md` structure
- Check `/autopaper` orchestration end-to-end on a simple idea
