# Troubleshooting Guide

## Quick Check

Run `/router status` — look for ❌ or ⚠️ marks.

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
