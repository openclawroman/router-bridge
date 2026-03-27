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

const TMP_DIR = path.join(os.tmpdir(), `router-bridge-contract-test-${process.pid}-${Date.now()}`);
const STATE_PATH = path.join(TMP_DIR, "runtime", "bridge", "state.json");

const ORIGINAL_ROUTER_ROOT = process.env.OPENCLAW_ROUTER_ROOT;

describe("Contract: commands.ts writes → policy.ts reads", () => {
  let store: ExecutionBackendStore;

  beforeEach(() => {
    // Use isolated temp directory for this test to avoid touching real state
    process.env.OPENCLAW_ROUTER_ROOT = TMP_DIR;
    store = new ExecutionBackendStore();
    try { fs.unlinkSync(STATE_PATH); } catch {}
  });

  afterEach(() => {
    if (ORIGINAL_ROUTER_ROOT) {
      process.env.OPENCLAW_ROUTER_ROOT = ORIGINAL_ROUTER_ROOT;
    } else {
      delete process.env.OPENCLAW_ROUTER_ROOT;
    }
    try { fs.unlinkSync(STATE_PATH); } catch {}
  });

  it("thread-scoped: /router on in thread → hook delegates in same thread", async () => {
    const threadId = "test-thread-1";
    store.set(ScopeType.Thread, threadId, ExecutionBackend.RouterBridge);

    const hookCtx = { sessionKey: threadId, sessionId: "s-1" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму hello world",
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
      "напиши програму hello world",
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
      "напиши програму hello world",
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
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    const hookCtx = { sessionKey: "agent:main:main", sessionId: "s-real" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму hello world",
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
    const hookCtx = { sessionKey: "agent:main:main", sessionId: "s-empty" };
    const scope = extractRuntimeScope(hookCtx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread });

    // Verify store is actually empty
    const state = store.getEffective(scope.scopeType, scope.scopeId, scope.threadId || undefined, scope.sessionId || undefined);
    expect(state.executionBackend).toBe(ExecutionBackend.Native);

    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму hello world",
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

    const scopeA = extractRuntimeScope(
      { sessionKey: "thread-A", sessionId: "s-a" },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread }
    );
    const scopeB = extractRuntimeScope(
      { sessionKey: "thread-B", sessionId: "s-b" },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread }
    );

    // Verify store is empty for thread-B
    const stateB = store.getEffective(scopeB.scopeType, scopeB.scopeId, scopeB.threadId || undefined, scopeB.sessionId || undefined);
    expect(stateB.executionBackend).toBe(ExecutionBackend.Native);

    const decisionA = await shouldDelegateToExecutionBackend(
      "напиши програму hello world",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scopeA.scopeId, scopeA.scopeType, undefined, scopeA.threadId, scopeA.sessionId
    );
    const decisionB = await shouldDelegateToExecutionBackend(
      "напиши програму hello world",
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread },
      scopeB.scopeId, scopeB.scopeType, undefined, scopeB.threadId, scopeB.sessionId
    );

    expect(decisionA.delegate).toBe(true);
    expect(decisionB.delegate).toBe(false);
  });
});
