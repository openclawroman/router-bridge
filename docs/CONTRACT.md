# Subprocess Protocol Contract

## Overview

router-bridge communicates with openclaw-router via stdin/stdout JSON over a one-shot subprocess invocation.

## Command

```
python3 <routerCommand> --config <routerConfigPath>
```

The `route` argument is ignored by the router (falls through to default routing behavior).

## Request (stdin → router)

A single JSON object conforming to `schemas/router_request.schema.json`.

Key fields:
- `task`: Human-readable task description
- `task_meta.task_id`: Task identifier (router reads from here)
- `task_meta.task_class`: `code_generation` | `code_review` | `planning` | `general`
- `task_meta.risk`: `low` | `medium` | `high`
- `task_meta.modality`: `text` | `multimodal`
- `task_meta.requires_repo_write`: Whether the task needs write access
- `prompt`: Full prompt text (also used as fallback summary)
- `scope`: Thread/session context for the router

## Response (stdout ← router)

A single JSON object conforming to `schemas/router_response.schema.json`.

Key fields (matching openclaw-router's actual output format):
- `success`: Whether execution succeeded (boolean)
- `tool`: Which executor was used (codex_cli, claude_code, etc.)
- `final_summary`: Result summary text
- `latency_ms`: Execution time
- `cost_estimate_usd`: Cost if available
- `normalized_error`: Error category on failure
- `protocol_version`: Protocol version (must be 1)

**Note:** The router uses `success` (not `ok`), `tool` (not `executor`), and `final_summary` (not `result`). This is the canonical format.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Execution error (parse error, router error, etc.) |
| 2 | Configuration error |
| 124 | Timeout (SIGKILL) |

## Health Check

```
python3 <routerCommand> --health
```

Returns JSON with health status. Non-zero exit on failure.

## Timeout Behavior

- Default: 60000ms
- Router is killed with SIGKILL on timeout
- Bridge reports timeout as execution failure with fallback-to-native

## Error Categories

The bridge classifies router failures into:
- **Timeout**: Process exceeded timeout_ms
- **Spawn error**: Binary not found, permission denied
- **Parse error**: stdout is not valid JSON
- **Execution error**: Router returned success=false
- **Protocol error**: Missing required response fields

All categories trigger native fallback when `fallbackToNativeOnError: true`.

## Error Response Format

When the router or wrapper encounters a fatal error, it returns:

```json
{
  "ok": false,
  "protocol_version": 1,
  "error_code": "ROUTER_UNHEALTHY",
  "message": "Router health probe failed",
  "fallback_recommended": true
}
```

Error codes:
- `ROUTER_NOT_FOUND` — Router entrypoint binary not found
- `CONFIG_NOT_FOUND` — Router config file not found
- `ROUTER_UNHEALTHY` — Health probe failed
- `TIMEOUT` — Execution exceeded timeout_ms
- `INTERNAL_ERROR` — Unexpected error in router
- `PROTOCOL_VERSION_MISMATCH` — Unsupported protocol version

All error responses include `fallback_recommended: true` when the bridge should fall back to native execution.

## Versioning

Both request and response include `protocol_version: 1`. Breaking changes increment this field.
