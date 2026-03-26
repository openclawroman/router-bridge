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
  OpenClaw session
  ↓
  router-bridge plugin:
    1. classifyTask("write me a function...") → coding task
    2. shouldDelegateToExecutionBackend() → yes, backend is router-bridge
    3. SubprocessRouterAdapter.execute() → spawn openclaw-router CLI
    4. CLI dispatches to Codex/Claude/MiniMax
    5. Response flows back to user
  ↓
User sees the result
```

When the backend is set to `native`, the model handles tasks directly — no delegation.

## Commands

### `/router on`
Enable router-bridge delegation for this thread/session.

### `/router off`
Switch back to native execution.

### `/router status`
Show current backend, scope, health diagnostics, and config.

## Natural Language

You can also use natural language (via the skill handler):

- "switch to external routing layer in this thread" → `/router on`
- "turn off router in this chat" → `/router off`
- "is router on?" → `/router status`

These map to the same handlers as `/router on|off|status` — single source of truth.

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
├── tests/                ← 127 tests across 8 files
└── openclaw.plugin.json  ← Manifest with configSchema
```

## Configuration

```json
{
  "backendMode": "native",
  "scopeMode": "thread",
  "routerCommand": "python3 /tmp/openclaw-router/cli.py",
  "routerConfigPath": "/tmp/openclaw-router/config/router.yaml",
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
| `routerCommand` | `python3 .../cli.py` | Shell command to invoke openclaw-router |
| `routerConfigPath` | `.../router.yaml` | Path to openclaw-router YAML config |
| `fallbackToNativeOnError` | `true` | Auto-fallback to native if router errors |
| `healthCacheTtlMs` | `30000` | Health check cache duration |
| `targetHarnessId` | `default` | Harness ID for ACP adapter (Phase 2) |
| `threadBindingMode` | `per-thread` | ACP session binding mode (Phase 2) |
| `acpSessionKey` | `null` | Pre-configured ACP session key (Phase 2) |

## Health Diagnostics

`/router status` runs 4 health checks:

1. **binary_exists** — Is the router CLI binary found? (PATH resolution for relative names, `fs.existsSync` for absolute paths)
2. **config_valid** — Does the config file exist?
3. **env_sufficient** — Is PATH set? Is the temp directory writable?
4. **subprocess_health** — Does `routerCommand --health` return success?

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
    "priority": "high"
  },
  "prompt": "Write a TypeScript function...",
  "scope": {
    "scope_id": "thread-abc",
    "thread_id": "t-123",
    "session_id": "s-456"
  },
  "timeout_ms": 60000
}
```

The router returns a JSON response with `success`, `output`, `duration_ms`, `cost_usd`, `tokens_used`, etc.

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
