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
Router execution exceeded timeout (default 120s). Check if openclaw-router is responsive:
```bash
echo '{"test":true}' | python3 ~/.openclaw/router/bin/openclaw-router
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
/router doctor          — preflight checks
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
