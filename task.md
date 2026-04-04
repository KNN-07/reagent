# ReAgent Implementation Tasks

## Phase 1: Monorepo Scaffolding
- [x] Read all source repos and plan architecture
- [x] Copy & rename oh-my-pi packages → `@reagent/ra-*` (7 packages)
- [x] Create `reagent/package.json` (bun workspace root)
- [x] Create `reagent/packages/research-agent/package.json`
- [x] Create `reagent/tsconfig.base.json` + `reagent/packages/research-agent/tsconfig.json`
- [x] Create `reagent/biome.json` (code style)
- [x] Create `reagent/bunfig.toml`
- [x] `bun install` — all 8 `@reagent/*` workspace packages linked
- [x] Stub `docs-index.generated.ts` (no docs dir in source)

## Phase 2: Core Infrastructure
- [x] `src/cli.ts` — entry point + slash-command router
- [x] `src/version.ts` — version constants
- [x] `src/context/CompactionService.ts` — context compaction
- [x] `src/memory/KairosMemory.ts` — background memory consolidation
- [x] `src/extensibility/custom-tools/loader.ts` — custom tool loader
- [x] `src/tools/submit-result.ts` — tool result wrapper
- [x] `src/tools/dependency-check.ts` — Lean/LaTeX/Exa detection with install guides
- [x] `src/slash-commands.ts` — slash command registry
- [x] `src/prompts/system.md` — ReAgent system prompt

## Phase 3: Workflow — /survey
- [x] `src/workflows/survey/index.ts` — prompt builders, dir helpers, slash command def
- [x] `src/workflows/survey/types.ts` — SurveyScope, VerifiedPaper, ResearchResult types
- [x] `src/workflows/survey/prompts/interview.md`
- [x] `src/workflows/survey/prompts/researcher.md`
- [x] `src/workflows/survey/prompts/writer.md`

## Phase 4: Workflow — /review
- [x] `src/workflows/review/index.ts` — 3-reviewer parallel review + meta-review
- [x] `src/workflows/review/prompts/reviewer-a-methods.md`
- [x] `src/workflows/review/prompts/reviewer-b-writing.md`
- [x] `src/workflows/review/prompts/reviewer-c-impact.md`

## Phase 5: Workflow — /autoresearch
- [x] `src/workflows/autoresearch/index.ts` — presets, setup wizard, slash command prompt

## Phase 6: Workflow — /autopaper
- [x] `src/workflows/autopaper/index.ts` — orchestrator + slash command prompt
- [x] `src/workflows/autopaper/lean-verifier.ts` — Lean 4 claim extraction + verification

## Phase 7: Root Files + Readme
- [x] `reagent/README.md`
- [x] `reagent/AGENTS.md`
- [x] `reagent/packages/research-agent/src/index.ts` (barrel exports)

## Phase 8: Native Build
- [x] Build `@reagent/ra-natives` Rust addon
  - `zig` 0.15.2 found at `/snap/bin/zig` ✓
  - Installed `clang`/`libclang-dev` (needed by `bindgen` for `zlob` FFI headers)
  - `cargo build --release` → compiled 657 crates, elapsed ~3m
  - `bun packages/natives/scripts/build-native.ts` → installed `packages/natives/native/pi_natives.linux-x64-modern.node` (81 MB)
