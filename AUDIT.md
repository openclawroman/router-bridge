# Phase 1 Audit — router-bridge

**Date:** 2026-03-26
**Branch:** main (commit 34c93b3)
**Tests:** 7 files, 122 tests, all passing ✅

---

## Task Compliance

| # | Task | Status | Files | Notes |
|---|------|--------|-------|-------|
| 1 | Plugin shell + manifest + configSchema | ✅ | `openclaw.plugin.json`, `index.ts`, `package.json` | Manifest has id/version/name/description, full `configSchema` with 6 properties (backendMode, scopeMode, routerCommand, routerConfigPath, fallbackToNativeOnError, healthCacheTtlMs), `uiHints` for all fields. `index.ts` exports default `register()` function registering command, skill, and service. |
| 2 | State model (enum not boolean) | ✅ | `src/types.ts`, `tests/types.test.ts` | `ExecutionBackend` is a proper enum with 3 values (native, router-bridge, router-acp). `ScopeType` is also an enum (thread, session, global). `RouterState` interface uses `executionBackend: ExecutionBackend` — no booleans for backend selection. |
| 3 | Scoped override storage | ✅ | `src/store.ts`, `tests/store.test.ts` | `ExecutionBackendStore` with key `scopeType:scopeId`. Supports get/set/clear/status/getEffective (thread→session→global fallback chain). Atomic writes via tmp+rename. Corrupt file recovery. Metadata preservation on set(). |
| 4 | Auto-reply commands | ✅ | `src/commands.ts`, `tests/commands.test.ts` | `/router on|off|status` dispatch via `handleRouterCommand()`. `resolveScope()` derives scope from ctx. Status includes health check via adapter, config display, fallback policy. |
| 5 | Adapter interface | ✅ | `src/adapters/base.ts`, `src/adapters/factory.ts`, `src/adapters/index.ts`, `tests/adapters.test.ts` | `RouterExecutionAdapter` interface with `health()`, `execute()`, `supportsPersistentSession()`, `closeScope()`, optional `getLastHealthError()`. Factory pattern: `createAdapter(config)` → NativeAdapter / SubprocessRouterAdapter / AcpRouterAdapter based on `config.backendMode`. |
| 6 | Subprocess payload | ✅ | `src/adapters/subprocess.ts`, `tests/payload.test.ts` | `RouterPayload` with task, task_id, task_meta, prompt, attachments, scope (scope_id, thread_id, session_id), context, timeout_ms. Verified by cat_stdin.sh round-trip test. JSON response parsing with fallback handling. |
| 7 | Delegation policy | ✅ | `src/policy.ts`, `tests/policy.test.ts` | `shouldDelegateToExecutionBackend()` checks: backend in scope → task classification → router health → delegation decision. `classifyTask()` uses regex pattern matching with coding/chat signal scoring. Respects `fallbackToNativeOnError` config. |
| 8 | Skill handler | ✅ | `src/skill.ts`, `skills/router/SKILL.md`, `tests/skill.test.ts` | `matchRouterIntent()` with enable/disable/status regex patterns. `handleRouterIntent()` delegates to same handlers as `/router` command (single source of truth). SKILL.md documents all trigger patterns. |
| 9 | Health diagnostics | ✅ | `src/adapters/subprocess.ts` (health method), `tests/adapters.test.ts` | 4 health checks: `binary_exists` (absolute path or PATH resolution via `which`), `config_valid` (file existence), `env_sufficient` (PATH + writable tmpdir), `subprocess_health` (`--health` flag). Cached with configurable TTL. `getLastHealthError()` for diagnostic tracing. |

---

## 5 Migration Rules

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | Store enum not boolean | ✅ | `ExecutionBackend` enum in `src/types.ts` with Native/RouterBridge/RouterAcp values. `RouterState.executionBackend` typed as `ExecutionBackend`, not `boolean`. Store keys use `scopeType:scopeId`. |
| 2 | Transport behind interface | ✅ | `RouterExecutionAdapter` interface in `src/adapters/base.ts`. Three implementations: `SubprocessRouterAdapter`, `AcpRouterAdapter`, `NativeAdapter`. Factory in `src/adapters/factory.ts` selects by `config.backendMode`. |
| 3 | Scope identity separate from transport | ✅ | `RouterState.scopeId` and `RouterState.threadId`/`sessionId` are independent fields — not derived from the adapter. `resolveScope()` in `commands.ts` computes scope from channel context, not transport. |
| 4 | Don't bind subprocess to commands | ✅ | Commands (`src/commands.ts`) use `createAdapter(config)` and `adapter.health()` — never reference `SubprocessRouterAdapter` directly. Health check in status command goes through the adapter interface. |
| 5 | Config-driven not hardcoded | ✅ | `PluginConfig` interface with `DEFAULT_CONFIG` in `src/types.ts`. `configSchema` in manifest for validation. `createAdapter()` reads config fields. All paths, commands, and TTLs come from config. |

---

## Execution Backend Switch Plugin

| Component | Phase 1 (router-bridge) | Phase 2 (router-acp) | Changes needed? |
|-----------|------------------------|----------------------|-----------------|
| Plugin shell | `index.ts` — register() | Same | ❌ No |
| Manifest | `openclaw.plugin.json` | Same | ❌ No |
| configSchema | 6 properties, backendMode enum includes "router-acp" | Same schema | ❌ No |
| Commands | `/router on|off|status` via `commands.ts` | Same | ❌ No |
| Skill | `skill.ts` intent matching → same handlers | Same | ❌ No |
| State storage | `store.ts` — enum-based, scoped | Same | ❌ No |
| Delegation policy | `policy.ts` — classifyTask + health check | Same | ❌ No |
| Health/status UX | Status shows backend, scope, health, config | Same | ❌ No |
| Adapter interface | `RouterExecutionAdapter` — 5 methods | Same interface | ❌ No |
| **Transport** | **`SubprocessRouterAdapter`** | **`AcpRouterAdapter` (stub exists)** | **✅ Yes — implement AcpRouterAdapter** |

**Summary:** Only `src/adapters/acp.ts` needs implementation. Everything else is transport-agnostic and ready for Phase 2.

---

## Gaps

- [ ] `AcpRouterAdapter` is a stub — `health()` and `execute()` return "Phase 2" placeholder responses. This is expected for Phase 1 but should be tracked.
- [ ] `configSchema.uiHints` references `targetHarnessId` but the field is not in `configSchema.properties` — it only exists in `PluginConfig` type and `DEFAULT_CONFIG`. The manifest schema and runtime config diverge on this field. Should add `targetHarnessId` to `configSchema.properties` or remove from `uiHints`.
- [ ] `handleRouterOn()` mutates state object after `store.set()` (`state.threadId = threadId`) but this mutation is not persisted — `store.set()` already wrote to disk. The `threadId`/`sessionId` fields will be lost on reload unless the caller happens to set them before `set()` (which they don't — `set()` is called first, then mutated). This is a minor bug: metadata won't survive process restart for the on→off→on cycle unless `set()` is called with the metadata already in the state.
- [ ] No vitest config file — tests run via `npx vitest run` with defaults. Consider adding `vitest.config.ts` for explicit configuration.
- [ ] `routerCommand` defaults to `python3 /tmp/openclaw-router/cli.py` — this is a hardcoded external dependency path. Works for config-driven architecture but couples to a specific deployment layout.

---

## File Inventory

```
openclaw.plugin.json          — Plugin manifest + configSchema
index.ts                      — Plugin entry: register() with command, skill, service
package.json                  — Dependencies (vitest)
src/types.ts                  — Enums, interfaces, DEFAULT_CONFIG
src/store.ts                  — ExecutionBackendStore (file-backed, scoped)
src/commands.ts               — /router on|off|status handlers
src/policy.ts                 — Task classification + delegation decision
src/skill.ts                  — Natural language intent matching
src/adapters/base.ts          — RouterExecutionAdapter interface
src/adapters/subprocess.ts    — SubprocessRouterAdapter (Phase 1 transport)
src/adapters/acp.ts           — AcpRouterAdapter (Phase 2 stub)
src/adapters/factory.ts       — createAdapter() factory
src/adapters/index.ts         — Barrel exports
skills/router/SKILL.md        — Skill documentation
tests/types.test.ts           — 9 tests
tests/store.test.ts           — 23 tests
tests/commands.test.ts        — 18 tests
tests/policy.test.ts          — 18 tests
tests/skill.test.ts           — 23 tests
tests/adapters.test.ts        — 20 tests
tests/payload.test.ts         — 11 tests
tests/cat_stdin.sh            — Test helper (echo stdin)
```
