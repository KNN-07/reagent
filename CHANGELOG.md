# Changelog

All notable changes to ReAgent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-04-05

### Added

- Initial ReAgent release — AI/ML research agent harness built on `@reagent/ra-*` packages
- `/survey` workflow: deep literature research → LaTeX + PDF + verified BibTeX output
- `/review` workflow: simulated multi-model peer review with 3 expert reviewer personas (methods, writing, impact)
- `/autoresearch` workflow: automated ML experimentation loop (idea → implement → run → analyse → improve)
- `/autopaper` workflow: end-to-end pipeline — survey → experiments → Lean 4 verification → paper writing → review
- Persistent research memory system at `~/.reagent/memory/<project>/` with per-session extraction and background consolidation
- Swarm multi-agent orchestration infrastructure for parallel reviewer/experiment subagents
- Custom tool loader scanning `~/.reagent/tools/` and `.reagent/tools/` for project-local tools
- ReAgent slash commands registered via `slashCommandCapability` in TUI autocomplete
- Full monorepo structure: `ra-coding-agent`, `ra-agent-core`, `ra-ai`, `ra-tui`, `ra-utils`, `ra-natives`, `ra-stats`, `research-agent`
- `reagent update` command for checking and installing updates from GitHub releases / npm

[Unreleased]: https://github.com/KNN-07/reagent/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/KNN-07/reagent/releases/tag/v1.0.0
