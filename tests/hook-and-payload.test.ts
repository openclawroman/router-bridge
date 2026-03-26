import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import { ExecutionBackendStore } from "../src/store";
import { SubprocessRouterAdapter } from "../src/adapters";
import type { TaskEnvelope } from "../src/adapters/base";

// ─── State persistence tests ───────────────────────────────────────────

// Use an isolated temp dir so parallel test files don't stomp our state
const TMP_DIR = path.join(os.tmpdir(), `router-bridge-hook-test-${process.pid}-${Date.now()}`);
const STATE_FILE = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");

let originalEnv: string | undefined;
beforeEach(() => {
  originalEnv = process.env.OPENCLAW_WORKSPACE;
  process.env.OPENCLAW_WORKSPACE = TMP_DIR;
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {}
});
afterEach(() => {
  process.env.OPENCLAW_WORKSPACE = originalEnv;
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {}
});

describe("store.set() with threadId/sessionId", () => {
  it("persists threadId and sessionId when set", () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, "t-123", "s-456");
    const state = store.get(ScopeType.Thread, "t-1");
    expect(state?.threadId).toBe("t-123");
    expect(state?.sessionId).toBe("s-456");
  });

  it("preserves existing threadId when not passed", () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, "t-123", "s-456");
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge);
    const state = store.get(ScopeType.Thread, "t-1");
    expect(state?.threadId).toBe("t-123");
    expect(state?.sessionId).toBe("s-456");
  });

  it("overwrites threadId when explicitly passed", () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, "t-old", "s-old");
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, "t-new", "s-new");
    const state = store.get(ScopeType.Thread, "t-1");
    expect(state?.threadId).toBe("t-new");
    expect(state?.sessionId).toBe("s-new");
  });

  it("threadId survives disk round-trip", () => {
    const store1 = new ExecutionBackendStore();
    store1.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, "t-persist", "s-persist");
    // Simulate restart by creating new store instance
    const store2 = new ExecutionBackendStore();
    const state = store2.get(ScopeType.Thread, "t-1");
    expect(state?.threadId).toBe("t-persist");
    expect(state?.sessionId).toBe("s-persist");
  });

  it("clears threadId/sessionId when explicitly set to null", () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, "t-123", "s-456");
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge, null, null);
    const state = store.get(ScopeType.Thread, "t-1");
    expect(state?.threadId).toBeNull();
    expect(state?.sessionId).toBeNull();
  });
});

// ─── Payload contract tests ────────────────────────────────────────────

const CAT_STDIN = path.join(__dirname, "cat_stdin.sh");

describe("RouterPayload contract", () => {
  it("includes task_id inside task_meta", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "write code",
      taskId: "task-42",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.task_id).toBe("task-42");
    expect(payload.task_meta.task_id).toBe("task-42");
    expect(payload.task_meta.task_class).toBe("code_generation");
    expect(payload.task_meta.risk).toBe("medium");
    expect(payload.task_meta.modality).toBe("text");
    expect(payload.task_meta.requires_repo_write).toBe(true);
  });

  it("maps review type to code_review task_class", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "review this PR",
      taskId: "task-43",
      scopeId: "s-1",
      taskMeta: { type: "review" },
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.task_meta.task_class).toBe("code_review");
    expect(payload.task_meta.requires_repo_write).toBe(false);
  });

  it("maps planning type to planning task_class", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "plan the architecture",
      taskId: "task-44",
      scopeId: "s-1",
      taskMeta: { type: "planning" },
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.task_meta.task_class).toBe("planning");
  });

  it("maps unknown type to general task_class", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "do something random",
      taskId: "task-45",
      scopeId: "s-1",
      taskMeta: { type: "other" },
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.task_meta.task_class).toBe("general");
    expect(payload.task_meta.requires_repo_write).toBe(false);
  });

  it("passes thread_id and session_id in scope", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "do something",
      taskId: "task-46",
      scopeId: "s-1",
      threadId: "t-99",
      sessionId: "s-88",
      taskMeta: { type: "coding" },
    });
    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.scope.thread_id).toBe("t-99");
    expect(payload.scope.session_id).toBe("s-88");
  });
});

// ─── Default config path tests ─────────────────────────────────────────

describe("DEFAULT_CONFIG router paths", () => {
  it("routerCommand points to ai-code-runner", () => {
    expect(DEFAULT_CONFIG.routerCommand).toContain("ai-code-runner");
  });

  it("routerConfigPath points to router.config.json", () => {
    expect(DEFAULT_CONFIG.routerConfigPath).toContain("router.config.json");
  });
});
