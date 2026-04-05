# ReAgent
![ReAgent Logo](assets/Logo.png)
**AI/ML Research Agent Harness** — an intelligent CLI that automates the full research lifecycle from literature survey to paper submission.

Built on [oh-my-pi](https://github.com/can1357/oh-my-pi)'s coding agent framework with research-specific workflows, background memory consolidation, and formal math verification.

---

## Features

| Workflow | Command | Description |
|----------|---------|-------------|
| Survey Generation | `/survey` | Deep literature research → LaTeX + PDF + verified BibTeX |
| Peer Review | `/review` | Simulated multi-model peer review (3 expert personas) |
| AutoResearch | `/autoresearch` | Automated ML experimentation loop |
| AutoPaper | `/autopaper` | End-to-end: survey → experiments → Lean verify → write → review |

### All Built-in Tools Included
bash, read/write/grep/find, fetch, browser, exa search & deep researcher, GitHub CLI, Python, Jupyter notebooks, MCP, LSP, autoresearch suite, and more.

---

## Quick Start

### Prerequisites

```bash
# Required: Bun runtime
curl -fsSL https://bun.sh/install | bash

# Required: Set at least one LLM API key
export ANTHROPIC_API_KEY=sk-...    # or GEMINI_API_KEY / OPENAI_API_KEY

# Recommended: Exa for deep research
export EXA_API_KEY=...             # https://exa.ai

# Optional: Lean 4 (for math proof verification in /autopaper)
# Install via elan: https://leanprover.github.io/lean4/doc/quickstart.html

# Optional: LaTeX compiler (for PDF output)
# tectonic (recommended): https://tectonic-typesetting.github.io
# or: pdflatex from TeX Live
```

### Install

```bash
cd reagent/
bun install
```

### Run

```bash
# Interactive mode (recommended)
bun run reagent

# Or directly:
bun run packages/research-agent/src/cli.ts
```

---

## Workflows

### `/survey` — Literature Survey

```
You: /survey
ReAgent: What topic would you like to survey?
You: diffusion models for protein structure prediction
ReAgent: [asks time range, venues, depth]
ReAgent: [confirms scope, starts research]
...
Output: ./surveys/diffusion-models-protein-2025-04-04/
  ├── main.tex        (IEEE two-column format)
  ├── references.bib  (all verified citations)
  ├── main.pdf        (compiled PDF)
  └── SUMMARY.md      (quick overview)
```

**Source Validation**: Every citation is verified against known academic databases (arXiv, Semantic Scholar, ACL Anthology, IEEE, Nature). Unverifiable sources are flagged and excluded.

---

### `/review` — Peer Review

```
You: /review
ReAgent: Paste your paper or provide a file path.
You: [pastes LaTeX or provides path]
ReAgent: Which venue? (NeurIPS, ICML, ACL, ...)
...
Output: review-report.md
  ├── Reviewer A (Methods): 7.5/10
  ├── Reviewer B (Writing): 8/10
  ├── Reviewer C (Impact): 7/10
  └── Meta-review: Weak Accept
```

Three parallel reviewers with different expertise: methods/rigor, writing/clarity, broader impact.

---

### `/autoresearch` — Automated Experiments

```
You: /autoresearch
ReAgent: [detects no autoresearch.md, shows presets]
You: 1 (PyTorch training preset)
ReAgent: [writes autoresearch.md and autoresearch.sh]
ReAgent: [runs experiment, analyzes results, improves code]
ReAgent: Run 1: val_acc=82.3% → Run 5: val_acc=87.1% (+4.8%)
```

Based on the upstream autoresearch module. Includes presets for PyTorch training, benchmark evaluation, and custom configs.

---

### `/autopaper` — Full Paper Pipeline

```
You: /autopaper
ReAgent: What's your research idea?
You: A new positional encoding for vision transformers that reduces FLOPs
ReAgent: [runs /survey on vision transformers + positional encodings]
ReAgent: [presents 5 research directions, asks user to choose]
ReAgent: [runs /autoresearch on the chosen approach]
ReAgent: [verifies mathematical claims with Lean 4 if available]
ReAgent: [writes LaTeX paper for ICLR]
ReAgent: [runs /review, presents scores]
ReAgent: Average: 7.2/10 — Weak Accept. Revise? [y/n]
```

---

## Memory System

ReAgent maintains persistent memory at `~/.reagent/memory/<project>/`:

- **Phase 1** (per-session): Extracts memorable facts after each session (papers found, experiment results, decisions)
- **Phase 2** (background): Consolidates into `MEMORY.md` — auto-injected into future sessions as context

Memory types: `paper_citation`, `research_finding`, `experiment_result`, `survey_topic`, `user_preference`, `project_context`.

---

## Configuration

### Custom Tools
Drop `.ts` files into `~/.reagent/tools/` (global) or `.reagent/tools/` (project-local).
They are auto-loaded at startup.

### System Prompt Override
Create `.reagent/SYSTEM.md` in your project directory to override or extend the default system prompt.

### Model Configuration
ReAgent uses standard model configuration:
```bash
reagent --model anthropic/claude-opus-4  # Specific model
reagent --provider openai --model gpt-4o  # Provider + model
```

---

## Architecture

```
reagent/
└── packages/
    ├── research-agent/  ← ReAgent workflows, CLI, memory
    ├── coding-agent/    ← oh-my-pi base (renamed @reagent/ra-coding-agent)
    ├── ai/              ← Multi-provider LLM client (@reagent/ra-ai)
    ├── agent/           ← Agent runtime (@reagent/ra-agent-core)
    ├── tui/             ← Terminal UI (@reagent/ra-tui)
    ├── utils/           ← Shared utils (@reagent/ra-utils)
    ├── natives/         ← Rust native bindings (@reagent/ra-natives)
    └── stats/           ← Observability dashboard (@reagent/ra-stats)
```

---

## License

MIT
