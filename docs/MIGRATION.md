# Phase 1 → Phase 2 Migration Guide

## What This Plugin Is

An **execution backend switch plugin**. It manages which backend executes coding tasks:
- **Phase 1**: `backendMode=router-bridge` — subprocess to openclaw-router CLI
- **Phase 2**: `backendMode=router-acp` — ACP session to coding harness

## What Changes in Phase 2

**Only the transport/runtime layer changes.**

| Component | Phase 1 | Phase 2 |
|-----------|---------|---------|
| Adapter | `SubprocessRouterAdapter` | `AcpRouterAdapter` |
| Transport | Spawn subprocess, pipe JSON via stdin | ACP session API |
| Scope binding | Thread → Session → Global | Same (configurable via `threadBindingMode`) |
| State persistence | Same `.router-state.json` | Same |
| Commands | `/router on|off|status` | Same |
| Skill | Natural language → handlers | Same |
| Health | Binary/config/env/subprocess checks | ACP session/harness checks |
| Policy | `shouldDelegateToExecutionBackend()` | Same |
| Config | `PluginConfig` | Add `threadBindingMode`, `acpSessionKey` |

## What Stays the Same

- **Plugin shell**: `openclaw.plugin.json`, `index.ts`, `register()` function
- **Slash commands**: `/router on|off|status` — same auto-reply behavior
- **Skill handler**: Same `matchRouterIntent()` + `handleRouterIntent()` delegation
- **State storage**: `ExecutionBackendStore` — get/set/clear/status, atomic writes
- **State model**: `ExecutionBackend` enum (native/router-bridge/router-acp), `ScopeType` enum
- **Scope identity**: Thread → Session → Global priority, same as Phase 1
- **Health/status UX**: Same `/router status` output, different underlying checks
- **Delegation policy**: `classifyTask()` and `shouldDelegateToExecutionBackend()` unchanged
- **Auto-reply**: No model call for /router commands

## Phase 2 Config Fields (added now, inactive until Phase 2)

- `threadBindingMode`: How ACP sessions bind to threads. Options: `"per-thread"`, `"per-session"`, `"free"`
- `acpSessionKey`: Pre-configured ACP session key for reconnecting to existing sessions

## How to Switch

In `openclaw.plugin.json` or config:
```json
{
  "backendMode": "router-acp",
  "targetHarnessId": "coding-harness",
  "threadBindingMode": "per-thread"
}
```

The plugin will automatically use `AcpRouterAdapter` instead of `SubprocessRouterAdapter`.
No other code changes needed — this is the "execution backend switch" contract.
