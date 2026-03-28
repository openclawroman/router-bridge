# Plugin Architecture

> For contributors and anyone debugging router-bridge.

## File Layout

```
router-bridge/
├── index.ts                  ← ACTIVE ENTRYPOINT (loaded by OpenClaw)
├── src/
│   ├── index.ts              ← STUB (re-exports from ../index.ts)
│   ├── commands.ts
│   ├── policy.ts
│   ├── store.ts
│   ├── scope.ts
│   ├── types.ts
│   ├── security.ts
│   ├── metrics.ts
│   ├── safety.ts
│   ├── recovery.ts
│   ├── dependencies.ts
│   ├── doctor.ts
│   └── adapters/
│       ├── base.ts
│       ├── subprocess.ts
│       ├── acp.ts
│       ├── factory.ts
│       └── index.ts
└── tests/
```

### ⚠️ Critical: Entrypoint

**`package.json` → `"main": "./index.ts"`** — OpenClaw loads the **root** `index.ts`, not `src/index.ts`.

When fixing bugs:
- Edit **root `index.ts`** for the hook handler, footer formatting, payload construction
- Edit `src/*.ts` for shared logic (policy, commands, store, adapters)
- Gateway transpiles TypeScript on load — **restart required** after changes

### ⚠️ Critical: Gateway TypeScript Caching

OpenClaw transpiles plugin TypeScript on module load. The compiled module is cached in memory. After editing plugin code:

```bash
openclaw gateway restart
```

Changes to `src/*.ts` that are imported by root `index.ts` will be picked up on restart. If changes aren't reflected, verify you're editing the correct file (root vs src).

## OpenClaw Hook API

The plugin registers a `before_prompt_build` hook. This is the main integration point.

### Handler Signature

```ts
api.on("before_prompt_build", (event, ctx) => {
  // Return prompt fields — they get merged into the agent's prompt
  return {
    prependContext: "...",        // prepended to user prompt
    prependSystemContext: "...",  // prepended to system prompt
    systemPrompt: "...",          // replaces system prompt (rarely used)
  };
});
```

### ⚠️ Critical: Return, Don't Mutate

**The hook must RETURN prompt fields.** The gateway ignores `ctx` mutations entirely.

```ts
// ❌ WRONG — ctx mutations are silently ignored
api.on("before_prompt_build", (event, ctx) => {
  ctx.routerResult = result.output;  // THIS DOES NOTHING
});

// ✅ CORRECT — return value is merged into prompt
api.on("before_prompt_build", (event, ctx) => {
  return { prependContext: result.output };
});
```

This was the root cause of 5+ hours of debugging. The delegation logs showed `delegate=true` but the agent never saw the router output.

### Hook Context (`ctx`)

The `ctx` object passed to the hook handler is `hookCtx`:

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | string | Agent identifier |
| `sessionKey` | string | Session key (e.g., `"agent:main:main"`) |
| `sessionId` | string | Session ID |
| `workspaceDir` | string | Workspace directory path |
| `messageProvider` | string | Message provider info |
| `trigger` | string | What triggered the hook |
| `channelId` | string | Channel identifier |

**Not available in hookCtx:** `cwd`, `gitBranch`, `messageId`

The gateway's merge logic at line ~110555:
```js
if (hookResult?.prependContext) {
  effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
}
```

So `prependContext` is literally prepended to the user's prompt text.

## Payload Construction

When the hook delegates to the router, it constructs a `TaskEnvelope`:

```ts
{
  task: taskText,
  taskId: ctx.messageId || `task-${Date.now()}`,
  scopeId,
  threadId,
  sessionId,
  taskMeta: { type: classification.taskType },
  taskClass: classification.taskClass,
  prompt: taskText,
  cwd: ctx.workspaceDir || process.cwd(),  // MUST be workspace dir
  recentContext: ...,
  repoBranch: ctx.gitBranch || null,
}
```

### ⚠️ Critical: `cwd` Must Be Workspace Directory

The `cwd` field is passed to the Python runner, which passes it to codex CLI:
```python
cmd = ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", ...]
result = subprocess.run(cmd, cwd=task.cwd, ...)
```

If `cwd` is wrong (e.g., gateway's working directory `/`), codex returns `toolchain_error` immediately.

Use `ctx.workspaceDir` (from hookCtx), not `ctx.cwd` (doesn't exist).

## Response Formatting

The footer is generated in **root `index.ts`**, not in the runner. The Python runner may also append its own footer — the hook strips it before adding the canonical one.

### Canonical Footer Format

```
🔧 {toolLabel} · {backendLabel} · {modelLabel} · {durationSeconds}s · ${cost}
```

Example: `🔧 Codex CLI · OpenAI · o3-mini · 2.4s · $0.0023`

### Label Mappings (in root index.ts)

```ts
const TOOL_LABELS = {
  "codex_cli": "Codex CLI",
  "claude_code": "Claude Code",
  "openrouter_api": "OpenRouter API",
};
const BACKEND_LABELS = {
  "openai_native": "OpenAI",
  "anthropic": "Anthropic",
  "openrouter": "OpenRouter",
};
```

### Runner Footer Stripping

The Python runner may append: `\n\n🔧 via codex_primary · 14825ms`

The hook strips this with regex before appending the canonical footer:
```ts
const cleanOutput = result.output.replace(/\n\n🔧[^\n]*$/, "").trimEnd();
```

### Duration: Milliseconds → Seconds

`result.durationMs` is in milliseconds. The footer displays seconds:
```ts
meta.push(`${(result.durationMs / 1000).toFixed(1)}s`);
```

## Scope Resolution

When the hook decides whether to delegate, it resolves scope in this priority:

1. `threadId` (from `ctx.sessionKey`)
2. `sessionId` (from `ctx.sessionId`)
3. `scopeType:scopeId` (explicit scope lookup)
4. `scopeType:default` (fallback for scope type)
5. `global:default` (global fallback)

The store singleton is shared between `commands.ts` and `policy.ts` — policy imports the store instance from commands.

## Quick Debugging Checklist

| Symptom | Check |
|---------|-------|
| Delegation fires but agent doesn't see output | Hook returns prompt fields (not ctx mutation) |
| `toolchain_error` with latency_ms=0 | `cwd` is wrong — check `ctx.workspaceDir` |
| Changes not reflected after edit | Edited wrong file (root vs src) or gateway not restarted |
| Footer shows "ms" instead of seconds | Editing `src/index.ts` but gateway loads root `index.ts` |
| Double footer (runner + hook) | Runner footer not stripped — check regex |
| Plugin crashes on load | TypeScript compilation error — check gateway logs |

## Gateway Logs

```bash
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep "router-bridge"
```

Key log lines:
- `[router-bridge] decision={...}` — delegation decision (delegate=true/false)
- `[router-bridge] execute result={...}` — execution outcome
- `[router-bridge] delegation OK, prependContext len=N` — success, prompt injected

## Testing

```bash
cd /tmp/router-bridge && bun test
```

Tests run against a temp directory via `OPENCLAW_ROUTER_ROOT` env var to avoid polluting the real state file at `~/.openclaw/router/`.

After changing shared modules (policy, commands, store, adapters), run:
```bash
bun test && git push
```
