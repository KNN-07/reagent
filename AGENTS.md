# ReAgent Development Rules

## Project Overview
ReAgent is an AI/ML research agent harness built on oh-my-pi's coding agent.
The primary package to work on is `packages/research-agent/`.

## Package Structure

| Package | Description |
|---------|-------------|
| `packages/research-agent` | Main ReAgent CLI and research workflows (**primary focus**) |
| `packages/coding-agent` | oh-my-pi base (renamed `@reagent/ra-coding-agent`) — modify carefully |
| `packages/ai` | Multi-provider LLM client (`@reagent/ra-ai`) |
| `packages/agent` | Agent runtime (`@reagent/ra-agent-core`) |
| `packages/tui` | Terminal UI (`@reagent/ra-tui`) |
| `packages/utils` | Shared utilities (`@reagent/ra-utils`) |
| `packages/natives` | Rust native bindings (`@reagent/ra-natives`) |
| `packages/stats` | Local observability dashboard (`@reagent/ra-stats`) |

## Code Quality

Follow oh-my-pi conventions (from `packages/coding-agent/AGENTS.md`):
- No `any` types unless absolutely necessary
- No `private`/`protected`/`public` — use `#` private fields
- No `ReturnType<>` — name types explicitly
- No inline imports — top-level imports only
- No `console.log` — use `logger` from `@reagent/ra-utils`
- Prompts live in `.md` files — never build prompts via string concatenation
- Import static text files: `import content from "./prompt.md" with { type: "text" }`

## Bun Runtime

This project runs on Bun. Use Bun APIs:
- File I/O: `Bun.file()`, `Bun.write()`
- Shell: `$\`command\`` from `"bun"`
- Sleep: `Bun.sleep(ms)`
- JSON5/JSONL: `Bun.JSON5.parse()`, `Bun.JSONL.parse()`
- String width: `Bun.stringWidth()`
- NEVER use `console.log` — use `logger`

## Commands

```bash
# From reagent/ root:
bun install              # Install all workspace dependencies
bun run reagent          # Run ReAgent CLI
bun run dev              # Same as above

# From packages/research-agent/:
bun run check            # TypeScript type check
bun test                 # Run tests
```

## Workflow Files

Slash command prompts live in `src/workflows/*/prompts/*.md`.
Never build prompt strings in TypeScript code — load via `with { type: "text" }`.

## Memory System

~/.reagent/memory/<project-slug>/
├── MEMORY.md            — consolidated index (updated by KairosMemory phase 2)
├── raw_memories.md      — raw per-session extracts (phase 1 output)
└── (topic files if added)

## External Dependencies (Optional)

- **Lean 4**: Math proof verification in /autopaper. Install via `elan`.
  If not available, verification is skipped (non-blocking).

- **tectonic** or **pdflatex**: PDF compilation in /survey and /autopaper.
  If not available, only .tex source is produced.

- **EXA_API_KEY**: Required for exa_researcher_start/poll tools.
  Get a key at https://exa.ai

## Never

- NEVER commit unless user asks
- NEVER run `bun run dev` or `bun build` (dev server runs indefinitely)
- NEVER modify already-released version sections in CHANGELOG.md
- NEVER use `git add -A` — only stage files you modified
