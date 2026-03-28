# router-bridge

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that switches the execution backend for coding tasks — from the built-in agent (native) to an external [openclaw-router](https://github.com/openclawroman/openclaw-router) CLI via subprocess, or to an ACP coding harness in Phase 2.

## What It Does

router-bridge is an **execution backend switch plugin**. It controls *which backend* executes coding tasks:

| Mode | Backend | What runs |
|------|---------|-----------|
| `native` | Built-in agent | The model handles tasks directly |
| `router-bridge` | [openclaw-router](https://github.com/openclawroman/openclaw-router) | Delegates to an external routing layer that classifies and dispatches tasks across multiple executors (Codex, Claude Code, OpenRouter) |
| `router-acp` | ACP session | Direct connection to a persistent coding harness (Phase 2) |

## How It Works

```
User: "write me a function to parse JSON"
  ↓
  OpenClaw session → before_prompt_build hook fires
  ↓
  router-bridge plugin:
    1. classifyTask("write me a function...") → coding task
    2. shouldDelegateToExecutionBackend() → checks scope (thread→session→global), delegates
    3. SubprocessRouterAdapter.execute() → spawn openclaw-router CLI
    4. CLI routes to Codex/Claude/MiniMax
    5. Result injected as ctx.routerResult
  ↓
User sees the result (or falls back to native on error)
```

When the backend is set to `native`, the model handles tasks directly — no delegation.

## Commands

| Command | Description |
|---------|-------------|
| `/router on` | Enable router-bridge delegation for this thread/session |
| `/router off` | Switch back to native execution |
| `/router status` | Show current backend, scope, health diagnostics, config, and metrics |
| `/router rollout [level]` | View or set rollout level (native, health-check, thread, session, global) |
| `/router shadow [mode]` | View or set shadow mode (off, observe) |
| `/router snapshot` | Take a config snapshot for rollback |
| `/router init-config` | Generate default openclaw-router config |
| `/router migrate-config` | Migrate existing config with backup |

## Natural Language

You can also use natural language (via the skill handler):

- "switch to external routing layer in this thread" → `/router on`
- "turn off router in this chat" → `/router off`
- "what's my router" → `/router status`

These map to the same handlers as the corresponding commands — single source of truth.

## Architecture

```
index.ts                  ← Plugin entry: registers command + skill + service
├── src/
│   ├── commands.ts       ← /router on|off|status handlers
│   ├── skill.ts          ← Natural language → command handler mapping
│   ├── policy.ts         ← classifyTask() + shouldDelegateToExecutionBackend()
│   ├── store.ts          ← Scoped state persistence (thread → session → global)
│   ├── types.ts          ← Enums, interfaces, defaults
│   └── adapters/
│       ├── base.ts       ← RouterExecutionAdapter interface
│       ├── subprocess.ts ← SubprocessRouterAdapter (Phase 1)
│       ├── acp.ts        ← AcpRouterAdapter (Phase 2 stub)
│       ├── factory.ts    ← createAdapter(config) — picks adapter by backendMode
│       └── index.ts      ← Barrel exports
├── skills/router/
│   └── SKILL.md          ← Trigger patterns for natural language
├── docs/
│   └── MIGRATION.md      ← Phase 1 → Phase 2 migration guide
├── tests/                ← 298 tests across 32 files
└── openclaw.plugin.json  ← Manifest with configSchema
```

## Scope Resolution

The plugin uses scoped state with fallback precedence:

1. **Thread** — checked first (if `threadId` is present)
2. **Session** — checked second (if `sessionId` is present)
3. **Global** — fallback when no thread/session scope is set

The delegation policy uses `getEffective()` to resolve the active backend at runtime, ensuring that `/router on` in a specific thread only affects that thread, while `/router on --scope global` affects all sessions.

## Limitations

- **One-shot execution**: The router CLI is invoked per-task via subprocess. There is no persistent session or streaming — each call is a complete stdin JSON → stdout JSON round-trip.
- **No cancellation**: Once spawned, a router task cannot be cancelled mid-flight.
- **Scope-only control**: The plugin does not register as an OpenClaw model provider. It uses execution hooks and delegation, not `/model` switching.

For persistent sessions with streaming and cancellation, see Phase 2 (ACP) in [docs/MIGRATION.md](docs/MIGRATION.md).

## Developer Docs

| Doc | Description |
|-----|-------------|
| [Architecture](docs/ARCHITECTURE.md) | Plugin internals, hook API, payload format, scope resolution |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common bugs, symptoms, and fixes (including known issues history) |
| [Installation](docs/INSTALL.md) | Prerequisites, path layout, upgrade guide |
| [Migration](docs/MIGRATION.md) | Phase 1 → Phase 2 migration guide |
| [Contract](docs/CONTRACT.md) | Response contract specification |

## Configuration

```json
{
  "backendMode": "native",
  "scopeMode": "thread",
  "routerCommand": "python3 /tmp/openclaw-router/bin/ai-code-runner",
  "routerConfigPath": "/tmp/openclaw-router/config/router.config.json",
  "fallbackToNativeOnError": true,
  "healthCacheTtlMs": 30000,
  "targetHarnessId": "default",
  "threadBindingMode": "per-thread",
  "acpSessionKey": null
}
```

### Config Fields

| Field | Default | Description |
|-------|---------|-------------|
| `backendMode` | `native` | `native`, `router-bridge`, or `router-acp` |
| `scopeMode` | `thread` | Where overrides apply: `thread`, `session`, or `global` |
| `routerCommand` | `python3 .../ai-code-runner` | Shell command to invoke openclaw-router |
| `routerConfigPath` | `.../router.config.json` | Path to openclaw-router JSON config |
| `fallbackToNativeOnError` | `true` | Auto-fallback to native if router errors |
| `healthCacheTtlMs` | `30000` | Health check cache duration |
| `targetHarnessId` | `default` | Harness ID for ACP adapter (Phase 2) |
| `threadBindingMode` | `per-thread` | ACP session binding mode (Phase 2) |
| `acpSessionKey` | `null` | Pre-configured ACP session key (Phase 2) |
| `rolloutLevel` | `native` | Rollout level: `native`, `health-check`, `thread`, `session`, `global` |
| `shadowMode` | `off` | Shadow mode: `off`, `observe` |

## Health Diagnostics

The adapter health check (used before delegation) runs 4 checks:

1. **binary_exists** — Is the router CLI binary found?
2. **config_valid** — Does the config file exist?
3. **env_sufficient** — Is PATH set? Is the temp directory writable?
4. **subprocess_health** — Does `routerCommand --health` return success?

`/router status` additionally runs 7 doctor checks: python availability, router binary, config file, runtime directory writable, secrets present, health probe, and security audit.

If any check fails, the plugin falls back to native execution (when `fallbackToNativeOnError: true`).

## openclaw-router Integration

The plugin delegates to [openclaw-router](https://github.com/openclawroman/openclaw-router), an external routing layer that:

- Classifies tasks by type (coding, review, chat, planning)
- Selects the best executor (Codex CLI, Claude Code, OpenRouter/MiniMax)
- Handles fallback chains and logging
- Supports config-driven executor selection

The communication is via **stdin JSON payload**:

```json
{
  "task": "Write a hello world function",
  "task_id": "task-42",
  "task_meta": {
    "type": "coding",
    "task_id": "task-42",
    "task_class": "code_generation",
    "risk": "medium",
    "modality": "text",
    "requires_repo_write": true
  },
  "prompt": "Write a TypeScript function...",
  "scope": {
    "scope_id": "thread-abc",
    "thread_id": "t-123",
    "session_id": "s-456"
  },
  "context": {
    "working_directory": "/tmp/openclaw-router",
    "git_branch": "main"
  },
  "timeout_ms": 60000
}
```

The router returns a JSON **ExecutorResult** via `stdout`:

```json
{
  "success": true,
  "task_id": "...",
  "tool": "codex_cli",
  "backend": "openai_native",
  "model_profile": "codex_primary",
  "exit_code": 0,
  "latency_ms": 1234,
  "cost_estimate_usd": 0.0023,
  "final_summary": "Task completed"
}
```

The bridge normalizes this via `normalizeResponse()` into a simpler shape:

| Raw Field | Normalized Field |
|-----------|-----------------|
| `final_summary` | `output` (text) |
| `model_profile` | `model` |
| `cost_estimate_usd` | `cost` |
| `latency_ms` | `duration` |

> **Note:** The `RouteDecision` (routing rationale, executor chain, state) is **not** returned on stdout. It is logged to `runtime/routing.jsonl` in the openclaw-router repo for audit/traceability.

## Phase 2 (ACP)

In Phase 2, only the **transport layer changes**:

| Component | Phase 1 | Phase 2 |
|-----------|---------|---------|
| Adapter | `SubprocessRouterAdapter` | `AcpRouterAdapter` |
| Transport | Subprocess + JSON via stdin | ACP session API |
| Everything else | Unchanged | Unchanged |

See [docs/MIGRATION.md](docs/MIGRATION.md) for the full migration guide.

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
