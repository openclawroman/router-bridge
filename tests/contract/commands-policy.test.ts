/**
 * Contract test: commands.ts (writer) → policy.ts (reader).
 *
 * Ensures that when commands.ts writes to the store via handleRouterOn(),
 * policy.ts can read it back via shouldDelegateToExecutionBackend().
 * This was the 3.5-hour debugging gap — both paths existed but were never
 * tested together.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionBackendStore } from "../../src/store";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../../src/types";
import { extractRuntimeScope } from "../../src/scope";
import { shouldDelegateToExecutionBackend } from "../../src/policy";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Contract: commands.ts writes → policy.ts reads", () => {
  let store: ExecutionBackendStore;
  const TMP_DIR = path.join(os.tmpdir(), `router-bridge-contract-test-${process.pid}-${Date.now()}`);
  const originalEnv = process.env.OPENCLAW_ROUTER_ROOT;

  beforeEach(() => {
    process.env.OPENCLAW_ROUTER_ROOT = path.join(TMP_DIR, "router");
    store = new ExecutionBackendStore();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENCLAW_ROUTER_ROOT = originalEnv;
    } else {
      delete process.env.OPENCLAW_ROUTER_ROOT;
    }
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("thread-scoped: /router on in thread → hook delegates in same thread", async () => {
    // Simulate commands.ts writing thread-scoped state
    const threadId = "test-thread-1";
    store.set(ScopeType.Thread, threadId, ExecutionBackend.RouterBridge);

    // Simulate hookCtx with matching sessionKey
    const hookCtx = { sessionKey: threadId, sessionId: "s-1" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    // Simulate policy.ts reading — uses its own store instance (file-based)
    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
  });

  it("global-scoped: /router on global → all threads delegate", async () => {
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const hookCtx = { sessionKey: "any-thread", sessionId: "s-2" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    const decision = await shouldDelegateToExecutionBackend(
      "code a function",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );

    expect(decision.delegate).toBe(true);
  });

  it("session-scoped: /router on session → hook delegates in same session", async () => {
    const sessionId = "sess-abc";
    store.set(ScopeType.Session, sessionId, ExecutionBackend.RouterBridge);

    const hookCtx = { sessionKey: "thread-x", sessionId };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session });

    const decision = await shouldDelegateToExecutionBackend(
      "code a hello world function",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session },
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );

    expect(decision.delegate).toBe(true);
  });

  it("thread:default fallback: /router on default thread → any Telegram session delegates", async () => {
    // This is the exact bug that broke production
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    const hookCtx = { sessionKey: "agent:main:main", sessionId: "s-real" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    const decision = await shouldDelegateToExecutionBackend(
      "напиши hello world",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );

    expect(decision.delegate).toBe(true);
  });

  it("no /router on → falls back to native", async () => {
    // Empty store — nothing enabled
    const hookCtx = { sessionKey: "agent:main:main", sessionId: "s-empty" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );

    expect(decision.delegate).toBe(false);
    expect(decision.backend).toBe(ExecutionBackend.Native);
  });

  it("different thread: thread-A delegates, thread-B does not", async () => {
    store.set(ScopeType.Thread, "thread-A", ExecutionBackend.RouterBridge);
    // thread-B has nothing

    const scopeA = extractRuntimeScope(
      { sessionKey: "thread-A", sessionId: "s-a" },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread }
    );
    const scopeB = extractRuntimeScope(
      { sessionKey: "thread-B", sessionId: "s-b" },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread }
    );

    const decisionA = await shouldDelegateToExecutionBackend(
      "code a function", { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scopeA.scopeId, scopeA.scopeType, undefined, scopeA.threadId, scopeA.sessionId
    );
    const decisionB = await shouldDelegateToExecutionBackend(
      "code a function", { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scopeB.scopeId, scopeB.scopeType, undefined, scopeB.threadId, scopeB.sessionId
    );

    expect(decisionA.delegate).toBe(true);
    expect(decisionB.delegate).toBe(false);
  });
});
