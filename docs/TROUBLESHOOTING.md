# Troubleshooting Guide

> See also [docs/ARCHITECTURE.md](ARCHITECTURE.md) for plugin internals.

## Quick Check

Run `/router status` — look for ❌ or ⚠️ marks.

Check gateway logs:
```bash
tail -50 /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep "router-bridge"
```

## Common Issues

### "Router not installed"
Run the installer:
```bash
curl -sL https://raw.githubusercontent.com/openclawroman/router-bridge/main/scripts/install_router_stack.sh | bash
```

### "Secrets not found"
Check `~/.openclaw/router/env/router.env` exists and has API keys set.

### "Timed out"
Router execution exceeded timeout (default 60s). Check if openclaw-router is responsive:
```bash
~/.openclaw/router/bin/ai-code-runner --health
```

### "Malformed response"
Router returned invalid JSON. Check router logs:
```bash
cat ~/.openclaw/router/runtime/router/latest.log
```

### "Auto-degraded: Fallback rate exceeded 80%"
Router had too many failures in a row. System automatically switched to native. It will re-probe periodically.

### "Version mismatch"
Plugin and router versions don't match. Re-run installer:
```bash
./install_router_stack.sh
```

### "Auth/permission error"
API key missing or invalid in `router.env`. Check and restart.

## Diagnostic Commands

```
/router status          — full status with metrics, version, config
/router rollout         — show current rollout level
/router shadow          — show current shadow mode
```

```bash
# Gateway logs (filtered to router-bridge)
tail -50 /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep "router-bridge"

# Test runner directly
echo '{"prompt":"print hello","cwd":"'"$HOME"'/.openclaw/workspace"}' | ~/.openclaw/router/bin/ai-code-runner

# Check codex auth
codex exec "say hello"

# Check gateway plugin state
openclaw gateway status
```

## Recovery

### Quick rollback
```
/router snapshot
/router restore <id>
```

### Force disable
```
/router off
```

## Common Errors

### toolchain_error on codex execution

**Symptoms:** Router returns `success: false`, `normalized_error: "toolchain_error"`, `exit_code: null`, `latency_ms: 0`

**Cause:** Codex CLI (`codex exec`) requires a working directory. If `context.working_directory` is not set, codex cannot find a workspace.

**Fix:** Ensure the bridge sends `context.working_directory` in the router request. The bridge sets this automatically from `ctx.cwd` (falls back to `process.cwd()`).

### "stdin is not a terminal" error

**Symptoms:** Codex CLI fails with `Error: stdin is not a terminal`

**Cause:** Using bare `codex [prompt]` (interactive mode) in subprocess context.

**Fix:** Use `codex exec [prompt]` for non-interactive execution. The router's codex executor already handles this — if you see this error, check that you're running the latest version of openclaw-router.

### Path(__file__) import fails via symlink

**Symptoms:** `ModuleNotFoundError: No module named 'router'` when running through symlink

**Cause:** `Path(__file__)` does not resolve symlinks. When `bin/ai-code-runner` is a symlink to `runner/openclaw-router/bin/ai-code-runner`, the import path breaks.

**Fix:** Use `Path(__file__).resolve()` instead of `Path(__file__)`. This was fixed in openclaw-router `f6cf4e9`.

---

## Critical Bugs (Known Issues History)

### Hook returns no output — agent never sees router result

**Symptoms:** Gateway logs show `delegate=true`, execution succeeds, but the agent's response has no router output. Agent behaves as if it received no delegated context.

**Cause:** The `before_prompt_build` hook handler mutates `ctx` instead of returning prompt fields. OpenClaw ignores `ctx` mutations — only the **return value** is merged into the prompt.

```ts
// ❌ WRONG — ctx mutations are silently discarded
api.on("before_prompt_build", (event, ctx) => {
  ctx.routerResult = result.output;  // ignored
});

// ✅ CORRECT — return value is merged into prompt
api.on("before_prompt_build", (event, ctx) => {
  return { prependContext: result.output };
});
```

**Fix:** Change the hook handler to RETURN `{ prependContext, prependSystemContext, ... }` instead of mutating `ctx`.

**Root cause:** 5+ hours of debugging across sessions because the API documentation wasn't explicit about this pattern.

### `toolchain_error` with latency_ms=0 — codex never runs

**Symptoms:** Router returns `success: false`, `normalized_error: "toolchain_error"`, `latency_ms: 0`. No artifact files created.

**Cause:** The `cwd` passed to the Python runner is wrong. Codex CLI requires a valid workspace directory. If `cwd` is empty or points to the gateway's working directory (`/` or `~/.openclaw/`), codex fails immediately.

**Root cause:** The hook handler uses `ctx.cwd` but the hook context (`hookCtx`) has `workspaceDir`, not `cwd`. `ctx.cwd` is `undefined`, so it falls back to `process.cwd()` (gateway dir).

```ts
// ❌ WRONG — hookCtx has no 'cwd' field
cwd: ctx.cwd || process.cwd(),

// ✅ CORRECT — hookCtx has 'workspaceDir'
cwd: (ctx as any).workspaceDir || process.cwd(),
```

**Fix:** Change `ctx.cwd` to `ctx.workspaceDir` in the payload construction in root `index.ts`.

**Verify:**
```bash
# Test runner directly with correct cwd
echo '{"prompt":"print hello","cwd":"/path/to/workspace"}' | ~/.openclaw/router/bin/ai-code-runner
```

### Changes not reflected after edit — gateway caches TypeScript

**Symptoms:** Plugin code is correct on disk, gateway restarts (PID changes), but behavior is unchanged.

**Cause:** OpenClaw transpiles plugin TypeScript on module load and caches the compiled module in memory. A simple `openclaw gateway restart` may not pick up changes if the LaunchAgent doesn't fully restart.

**Fix:**
```bash
openclaw gateway restart
```

If that doesn't work:
```bash
openclaw gateway stop && sleep 2 && openclaw gateway start
```

### Editing wrong file — `src/index.ts` vs root `index.ts`

**Symptoms:** Changes in `src/index.ts` have no effect. Gateway loads from root `index.ts` (the entrypoint).

**Cause:** `package.json` declares `"main": "./index.ts"` — the root file is the active entrypoint, not `src/index.ts`. The two files can diverge.

**Fix:** Edit the **root** `index.ts` for the hook handler, footer, and payload logic. Edit `src/*.ts` only for shared modules (policy, commands, store, adapters).

### Double footer — runner footer + hook footer

**Symptoms:** Response shows two footers: one from the Python runner (`🔧 via codex_primary · 14825ms`) and one from the hook.

**Cause:** The Python runner appends its own footer to `final_summary`. The hook then appends ANOTHER footer.

**Fix:** Strip the runner footer before appending the canonical one:
```ts
const cleanOutput = result.output.replace(/\n\n🔧[^\n]*$/, "").trimEnd();
```

### Footer shows milliseconds instead of seconds

**Symptoms:** Footer shows `8867ms` instead of `8.9s`.

**Cause:** Either editing `src/index.ts` (wrong file), or the root `index.ts` still has the old `result.durationMs + "ms"` format.

**Fix:** In root `index.ts`:
```ts
// ❌ WRONG
meta.push(`${result.durationMs}ms`);

// ✅ CORRECT
meta.push(`${(result.durationMs / 1000).toFixed(1)}s`);
```

### Router command not found in PATH

**Symptoms:** `ai-code-runner not found` when spawned by the adapter.

**Cause:** The gateway's environment may not include `/usr/local/bin` in PATH. The runner binary is at `~/.openclaw/router/bin/ai-code-runner`.

**Fix:** The adapter resolves the binary path using `which` or absolute path. Verify:
```bash
ls -la ~/.openclaw/router/bin/ai-code-runner
```

If it's a symlink, verify the target exists:
```bash
readlink ~/.openclaw/router/bin/ai-code-runner
ls -la $(readlink ~/.openclaw/router/bin/ai-code-runner)
```
