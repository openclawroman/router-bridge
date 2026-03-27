# Subprocess Protocol Contract

## Overview

router-bridge communicates with openclaw-router via stdin/stdout JSON over a one-shot subprocess invocation.

## Command

```
python3 <routerCommand> --config <routerConfigPath> route
```

## Request (stdin → router)

A single JSON object conforming to `schemas/router_request.schema.json`.

Key fields:
- `protocol_version`: Protocol version (must be 1)
- `task`: Human-readable task description
- `task_id`: Unique task identifier
- `task_meta`: Task classification object:
  - `task_id`: Task identifier (router reads task_id from here and top-level)
  - `task_class`: `implementation` | `code_review` | `planner` | `refactor` | `test` | `architecture` | `analysis` | `documentation` | `deployment` | `security`
  - `risk`: `low` | `medium` | `high` | `critical`
  - `modality`: `text` | `image` | `video` | `mixed`
  - `requires_repo_write`: Whether the task needs write access
  - `requires_multimodal`: Whether multimodal capabilities are needed
  - `has_screenshots`: Whether screenshots are involved
- `prompt`: Full prompt text (also used as fallback summary)
- `attachments`: Array of file attachments
- `scope`: Thread/session context for the router:
  - `scope_id`: Scope identifier
  - `thread_id`: Thread identifier (nullable)
  - `session_id`: Session identifier (nullable)
- `context`: Execution context:
  - `working_directory`: **Required** — Working directory path. Codex exec (`codex exec [prompt]`) will fail with `toolchain_error` if this is not set. The bridge always sets this from the current task context.
  - `git_branch`: Current git branch
  - `git_commit`: Current git commit (optional)
  - `recent_files`: Recently modified files (optional)
- `timeout_ms`: Execution timeout in milliseconds

## Response (stdout ← router)

A single JSON object conforming to `schemas/router_response.schema.json`.

Key fields (matching openclaw-router's actual ExecutorResult output format):
- `protocol_version`: Protocol version (must be 1)
- `task_id`: Task identifier matching the request
- `tool`: Which executor was used (`codex_cli`, `claude_code`, etc.)
- `backend`: Backend used (`openai_native`, `anthropic`, `openrouter`)
- `model_profile`: Model profile used (e.g. `openrouter_minimax`)
- `success`: Whether execution succeeded (boolean)
- `normalized_error`: Error category on failure (null on success)
- `exit_code`: Process exit code
- `latency_ms`: Execution time in milliseconds
- `cost_estimate_usd`: Cost if available
- `artifacts`: Array of generated file paths
- `stdout_ref`: Reference to stdout output (nullable)
- `stderr_ref`: Reference to stderr output (nullable)
- `final_summary`: Human-readable result summary text
- `request_id`: Provider request ID for tracing (nullable)

**Note:** The router uses `success` (not `ok`), `tool` (not `executor`), `final_summary` (not `result`), `model_profile` (not `model`), `cost_estimate_usd` (not `cost_usd`), and `latency_ms` (not `duration_ms`). This is the canonical format. The bridge normalizes these to its internal fields:
- `final_summary` → output text
- `model_profile` → model name
- `cost_estimate_usd` → cost
- `latency_ms` → duration
- `normalized_error` → error details on failure

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

## Bridge Error Handling

The bridge does not return structured error JSON. On failure, it returns an `ExecuteResult` with `success: false` and a text `output` describing the error. All categories trigger native fallback when `fallbackToNativeOnError: true`.

Protocol version mismatches are detected during response parsing: if the router returns `protocol_version` other than `1`, execution fails immediately.

## Router Error Output

When the router encounters a fatal error before it can produce an ExecutorResult (e.g. invalid JSON input on stdin), it writes an error JSON to **stderr** (not stdout) and exits non-zero:

```json
{"error": "Invalid JSON input: ...", "protocol_version": 1}
```

The bridge detects this via non-zero exit code + empty/invalid stdout.

## Environment Variables

The router sets the following environment variables for executor subprocesses (from `scope` and `context` in the input JSON):

| Env Var | Source Field | Description |
|---------|-------------|-------------|
| `OPENCLAW_SCOPE_ID` | `scope.scope_id` | Scope identifier |
| `OPENCLAW_THREAD_ID` | `scope.thread_id` | Thread identifier |
| `OPENCLAW_SESSION_ID` | `scope.session_id` | Session identifier |
| `OPENCLAW_GIT_BRANCH` | `context.git_branch` | Current git branch |
| `OPENCLAW_WORKING_DIR` | `context.working_directory` | Working directory path |

## Versioning

Both request and response include `protocol_version: 1`. Breaking changes increment this field.
