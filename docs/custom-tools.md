# Custom Tools

Custom tools are model-callable functions that plug into the same tool execution pipeline as built-in tools.

A custom tool is a TypeScript/JavaScript module that exports a `CustomTool` object (or array of them) as its **default export**. ReAgent loads these at startup via Bun's native TypeScript runtime — no compilation step required.

## What this is (and is not)

- **Custom tool**: callable by the model during a turn (`execute` + TypeBox schema).
- **Extension**: lifecycle/event framework that can register tools and intercept/modify events.
- **Hook**: external pre/post command scripts.
- **Skill**: static guidance/context package, not executable tool code.

If you need the model to call code directly, use a custom tool.

## Integration paths in current code

There are two active integration styles:

1. **SDK-provided custom tools** (`options.customTools`)
   - Wrapped into agent tools via `CustomToolAdapter` or extension wrappers.
   - Always included in the initial active tool set in SDK bootstrap.

2. **Filesystem-discovered modules via loader API** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Exposed as library APIs in `src/extensibility/custom-tools/loader.ts`.
   - Host code can call these to discover and load tool modules from config/provider/plugin paths.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## Discovery locations

### ReAgent loader (`research-agent/src/extensibility/custom-tools/loader.ts`)

`loadCustomTools(cwd)` scans two directories in order:

1. **Global**: `~/.reagent/tools/*.{ts,js}`
2. **Project-local**: `<cwd>/.reagent/tools/*.{ts,js}`

Files that fail to load are recorded in `errors` but don't abort the rest:

```ts
interface LoadedCustomTools {
  tools: CustomTool[];
  errors: string[];
}
```

### Coding-agent capability-based discovery (`discoverAndLoadCustomTools`)

The underlying `@reagent/ra-coding-agent` also supports capability-provider discovery:

1. Capability providers (`toolCapability`), including:
   - Native ReAgent config (`~/.reagent/agent/tools`, `.reagent/tools`)
   - Claude config (`~/.claude/tools`, `.claude/tools`)
   - Codex config (`~/.codex/tools`, `.codex/tools`)
   - Claude marketplace plugin cache provider
2. Installed plugin manifests (`~/.reagent/plugins/node_modules/*` via plugin loader)
3. Explicit configured paths passed to the loader

### Important behavior

- Duplicate resolved paths are deduplicated.
- Tool name conflicts are rejected against built-ins and already-loaded custom tools.
- `.md` and `.json` files are discovered as tool metadata by some providers, but the executable module loader rejects them as runnable tools.
- Relative configured paths are resolved from `cwd`; `~` is expanded.

## Module contract

Export a `CustomTool` object (or array) as the default export. Import types from `@reagent/ra-coding-agent`:

```ts
import { Type } from "@sinclair/typebox";
import type { CustomTool } from "@reagent/ra-coding-agent/extensibility/custom-tools";

const repoStats: CustomTool = {
	name: "repo_stats",
	label: "Repo Stats",
	description: "Counts tracked TypeScript files",
	parameters: Type.Object({
		glob: Type.Optional(Type.String({ default: "**/*.ts" })),
	}),

	async execute(toolCallId, params, onUpdate, ctx, signal) {
		onUpdate?.({
			content: [{ type: "text", text: "Scanning files..." }],
			details: { phase: "scan" },
		});

		const result = await ctx.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: ctx.cwd });
		if (result.killed) {
			throw new Error("Scan was cancelled");
		}
		if (result.code !== 0) {
			throw new Error(result.stderr || "git ls-files failed");
		}

		const files = result.stdout.split("\n").filter(Boolean);
		return {
			content: [{ type: "text", text: `Found ${files.length} files` }],
			details: { count: files.length, sample: files.slice(0, 10) },
		};
	},

	onSession(event) {
		if (event.reason === "shutdown") {
			// cleanup resources if needed
		}
	},
};

export default repoStats;
// export default [repoStats, anotherTool]; // array also supported

## API surface (`CustomTool` interface)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✓ | Unique tool name (global in session registry) |
| `label` | `string` | | Display label shown in TUI |
| `description` | `string` | ✓ | Model-facing tool description |
| `parameters` | TypeBox schema | ✓ | Input parameter schema (`Type.Object(...)`) |
| `execute` | function | ✓ | Main execution handler |
| `onSession` | function | | Session lifecycle hook |
| `renderCall` | function | | Custom call rendering (TUI) |
| `renderResult` | function | | Custom result rendering (TUI) |

### `execute` context (`ctx`)

- `cwd`: host working directory
- `exec(command, args, options?)`: process execution helper
- `ui`: UI context (no-op in headless/agent-only modes)
- `hasUI`: `false` in non-interactive flows
- `logger`: shared file logger (`@reagent/ra-utils`)
- `sessionManager`: access session state/history for stateful tools
- `abort()`: request abort of the current agent operation
- `pushPendingAction(action)`: register a preview action for the `resolve` tool (see `resolve-tool-runtime.md`)

## Execution contract and typing

`CustomTool.execute` signature:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` is statically typed from your TypeBox schema via `Static<TParams>`.
- Runtime argument validation happens before execution in the agent loop.
- `onUpdate` emits partial results for UI streaming.
- `ctx` includes session/model state and an `abort()` helper.
- `signal` carries cancellation.

`CustomToolAdapter` bridges this to the agent tool interface and forwards calls in the correct argument order.

## How tools are exposed to the model

- Tools are wrapped into `AgentTool` instances (`CustomToolAdapter` or extension wrappers).
- They are inserted into the session tool registry by name.
- In SDK bootstrap, custom and extension-registered tools are force-included in the initial active set.
- CLI `--tools` currently validates only built-in tool names; custom tool inclusion is handled through discovery/registration paths and SDK options.

## Rendering hooks

Optional rendering hooks:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Runtime behavior in TUI:

- If hooks exist, tool output is rendered inside a `Box` container.
- `renderResult` receives `{ expanded, isPartial, spinnerFrame? }`.
- Renderer errors are caught and logged; UI falls back to default text rendering.

## Session/state handling

Optional `onSession(event, ctx)` receives session lifecycle events, including:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Use `ctx.sessionManager` to reconstruct state from history when branch/session context changes.

## Failures and cancellation semantics

### Synchronous/async failures

- Throwing (or rejected promises) in `execute` is treated as tool failure.
- Agent runtime converts failures into tool result messages with `isError: true` and error text content.
- With extension wrappers, `tool_result` handlers can further rewrite content/details and even override error status.

### Cancellation

- Agent abort propagates through `AbortSignal` to `execute`.
- Forward `signal` to subprocess work (`ctx.exec(..., { signal })`) for cooperative cancellation.
- `ctx.abort()` lets a tool request abort of the current agent operation.

### onSession errors

- `onSession` errors are caught and logged as warnings; they do not crash the session.

## Real constraints to design for

- Tool names must be globally unique in the active registry.
- Prefer deterministic, schema-shaped outputs in `details` for renderer/state reconstruction.
- Guard UI usage with `ctx.hasUI`.
- Treat `.md`/`.json` in tool directories as metadata, not executable modules.
