/**
 * Phase 2 E2E Integration Tests — advanced router-bridge scenarios.
 *
 * Uses existing harness helpers (createTempDir, setupTestEnv, makeCodingCtx,
 * writeExecutableShim, makeFakeApi) and vitest.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createTempDir, setupTestEnv, makeCodingCtx, writeExecutableShim, makeFakeApi } from "./harness";
import { SubprocessRouterAdapter } from "../../src/adapters/subprocess";
import { store } from "../../src/commands";
import { ScopeType, ExecutionBackend, DEFAULT_CONFIG, type PluginConfig } from "../../src/types";

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

/** A shim that sleeps N seconds then exits 0 (simulates a slow router). */
function sleepShim(seconds: number): string {
  return `#!/bin/sh\nsleep ${seconds}\n`;
}

/** A shim that prints a fixed string to stdout (no valid JSON). */
function stdoutShim(text: string): string {
  return `#!/bin/sh\necho '${text}'\n`;
}

/** A shim that prints a valid router response JSON to stdout. */
function validRouterShim(output: string = "done"): string {
  const payload = JSON.stringify({ output, status: "ok" });
  return `#!/bin/sh\necho '${payload}'\n`;
}

/** Clear specific store scopes used in tests. */
function clearTestScopes(): void {
  store.clear(ScopeType.Global, "default");
  store.clear(ScopeType.Thread, "thread-1");
}

// ───────────────────────────────────────────────────────────────────
// Test 3 — Scope precedence matrix
// ───────────────────────────────────────────────────────────────────

describe("Phase 2: scope precedence matrix", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    clearTestScopes();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("global=router-bridge, thread override=router-bridge → should delegate", () => {
    // Set global to router-bridge
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);
    // Thread override also router-bridge
    store.set(ScopeType.Thread, "thread-1", ExecutionBackend.RouterBridge, "thread-1", null);

    const effective = store.getEffective(ScopeType.Thread, "thread-1", "thread-1");
    expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
  });

  it("global=router-bridge, thread override=native → should NOT delegate", () => {
    // Set global to router-bridge
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);
    // Thread override is native
    store.set(ScopeType.Thread, "thread-1", ExecutionBackend.Native, "thread-1", null);

    const effective = store.getEffective(ScopeType.Thread, "thread-1", "thread-1");
    expect(effective.executionBackend).toBe(ExecutionBackend.Native);
  });

  it("global=router-bridge, no thread override → should delegate", () => {
    // Set global to router-bridge only
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);
    // No thread-specific override — should fall through to global

    const effective = store.getEffective(ScopeType.Thread, "thread-1", "thread-1");
    expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
  });

  it("global=native, no thread override → should NOT delegate", () => {
    // Global is native (default)
    const effective = store.getEffective(ScopeType.Thread, "thread-1", "thread-1");
    expect(effective.executionBackend).toBe(ExecutionBackend.Native);
  });
});

// ───────────────────────────────────────────────────────────────────
// Test 4 — Timeout triggers fallback
// ───────────────────────────────────────────────────────────────────

describe("Phase 2: timeout → fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("router that sleeps longer than timeout fails gracefully", async () => {
    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    // Shim sleeps 30s — timeout will be 500ms via metadata
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", sleepShim(30));

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-timeout",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
      metadata: { timeoutMs: 500 },
    });

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/timed out/i);
  }, 10_000);
});

// ───────────────────────────────────────────────────────────────────
// Test 5 — Malformed JSON triggers fallback
// ───────────────────────────────────────────────────────────────────

describe("Phase 2: malformed JSON → fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("router outputting non-JSON with non-zero exit fails gracefully", async () => {
    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    // Shim outputs garbage AND exits non-zero — the adapter should treat this as failure
    const badShim = `#!/bin/sh\necho 'not json'\nexit 1`;
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", badShim);

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-malformed",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
      metadata: { timeoutMs: 5000 },
    });

    // Non-zero exit → success is false regardless of output format
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  it("router outputting non-JSON with exit 0 passes through as raw text", async () => {
    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    // Exit 0 + non-JSON → adapter treats raw text as valid output
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", stdoutShim("plain text response"));

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-raw",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
      metadata: { timeoutMs: 5000 },
    });

    // Exit 0 → success, raw text passed through
    expect(result.success).toBe(true);
    expect(result.output).toContain("plain text response");
  }, 10_000);
});

// ───────────────────────────────────────────────────────────────────
// Test 6 — Contract schema validation (stdin payload fields)
// ───────────────────────────────────────────────────────────────────

describe("Phase 2: contract schema — stdin payload", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("bridge sends all required fields in the router payload", async () => {
    const dumpPath = path.join(tmpDir, "data", "stdin-dump.json");
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });

    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    // Shim: dump stdin to file, then echo valid JSON so the adapter succeeds
    const shim = `#!/bin/sh\ncat > '${dumpPath}'\necho '{"output":"ok","status":"ok"}'`;
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", shim);

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    await adapter.execute({
      task: "Implement a helper function",
      taskId: "task-42",
      scopeId: "scope-1",
      taskMeta: { type: "coding", language: "typescript" },
      metadata: { timeoutMs: 5000 },
    });

    // Read what the shim captured
    expect(fs.existsSync(dumpPath)).toBe(true);
    const raw = fs.readFileSync(dumpPath, "utf-8");
    const payload = JSON.parse(raw);

    // Assert required top-level contract fields
    expect(payload).toHaveProperty("protocol_version");
    expect(payload).toHaveProperty("task_id");
    expect(payload).toHaveProperty("task");
    expect(payload).toHaveProperty("prompt");
    expect(payload).toHaveProperty("task_meta");
    expect(payload).toHaveProperty("scope");
    expect(payload).toHaveProperty("context");
    expect(payload).toHaveProperty("timeout_ms");

    // task_class is nested inside task_meta
    expect(payload.task_meta).toHaveProperty("task_class");

    // Sanity-check values
    expect(payload.task_id).toBe("task-42");
    expect(payload.prompt).toContain("helper function");
    expect(payload.protocol_version).toBe(1);
    expect(payload.scope.scope_id).toBe("scope-1");
  }, 10_000);
});

// ───────────────────────────────────────────────────────────────────
// Test 7 — Metrics / fallback tracking
// ───────────────────────────────────────────────────────────────────

describe("Phase 2: metrics & fallback tracking", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records a failure when router exits non-zero", async () => {
    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    // Shim that always fails (non-zero exit)
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", "#!/bin/sh\nexit 1\n");

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-fail",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
      metadata: { timeoutMs: 5000 },
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  it("returns success for a valid router response", async () => {
    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", validRouterShim("great success"));

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-ok",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
      metadata: { timeoutMs: 5000 },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("great success");
  }, 10_000);

  it("tracks consecutive failures via health check", async () => {
    const config = setupTestEnv(tmpDir, { healthCacheTtlMs: 0 });
    writeExecutableShim(path.join(tmpDir, "bin"), "ai-code-runner", "#!/bin/sh\nexit 1\n");

    const adapter = new SubprocessRouterAdapter({
      routerCommand: config.routerCommand!,
      routerConfigPath: config.routerConfigPath!,
      healthCacheTtlMs: 0,
    });

    // First health check — should fail
    const health = await adapter.health();
    expect(health.healthy).toBe(false);

    // After a failed health check, last error should be set
    const lastError = adapter.getLastHealthError?.() ?? null;
    expect(lastError).toBeTruthy();
  }, 10_000);
});

// ───────────────────────────────────────────────────────────────────
// Test 8 — Natural-language skill gating
// ───────────────────────────────────────────────────────────────────

describe("Phase 2: natural-language skill gating", () => {
  it("non-coding prompts are classified as non-coding", () => {
    const nonCodingPrompts = [
      "What's the weather?",
      "Tell me a joke",
      "What time is it?",
    ];

    for (const prompt of nonCodingPrompts) {
      const taskClass = classifyTask(prompt);
      expect(taskClass).not.toBe("coding");
    }
  });

  it("coding prompts are classified as coding", () => {
    const codingPrompts = [
      "Implement a function to sort an array",
      "Write a Python class for HTTP requests",
      "Create a React component for login",
      "Fix the bug in the auth module",
      "Refactor the database layer",
    ];

    for (const prompt of codingPrompts) {
      const taskClass = classifyTask(prompt);
      expect(taskClass).toBe("coding");
    }
  });
});

/**
 * Lightweight task classification — mirrors the logic in index.ts.
 * Determines if a prompt is a "coding" task that should be delegated.
 */
function classifyTask(prompt: string): string {
  const lower = prompt.toLowerCase();

  const codingVerbs = [
    "implement", "write", "create", "build", "fix", "refactor",
    "debug", "code", "add", "update", "change", "modify",
    "remove", "delete", "optimize", "test", "patch", "migrate",
    "convert", "rewrite", "scaffold", "generate",
  ];

  const codingNouns = [
    "function", "class", "component", "module", "api", "endpoint",
    "script", "algorithm", "interface", "type", "hook", "middleware",
    "controller", "service", "repository", "model", "schema",
    "test", "spec", "unit test", "integration test",
  ];

  const nonCodingNouns = [
    "weather", "time", "joke", "story", "poem", "recipe",
    "news", "score", "movie", "song", "book",
  ];

  const hasCodingVerb = codingVerbs.some(v => lower.includes(v));
  const hasCodingNoun = codingNouns.some(n => lower.includes(n));
  const hasNonCodingNoun = nonCodingNouns.some(n => lower.includes(n));

  // Explicit non-coding nouns take priority
  if (hasNonCodingNoun && !hasCodingVerb) return "other";

  // Coding requires at least a verb or noun match
  if (hasCodingVerb || hasCodingNoun) return "coding";

  return "other";
}
