import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ExecutionBackendStore } from "../../src/store";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../../src/types";
import { extractRuntimeScope } from "../../src/scope";
import { shouldDelegateToExecutionBackend } from "../../src/policy";
import { classifyTask } from "../../src/policy";

const TMP_DIR = path.join(os.tmpdir(), `router-bridge-smoke-test-${process.pid}-${Date.now()}`);
const STATE_FILE = path.join(TMP_DIR, "runtime", "bridge", "state.json");

const ORIGINAL_ROUTER_ROOT = process.env.OPENCLAW_ROUTER_ROOT;

describe("Smoke: post-gateway-restart delegation", () => {
  let store: ExecutionBackendStore;

  beforeEach(() => {
    process.env.OPENCLAW_ROUTER_ROOT = TMP_DIR;
    store = new ExecutionBackendStore();
    try { fs.unlinkSync(STATE_FILE); } catch {}
  });

  afterEach(() => {
    if (ORIGINAL_ROUTER_ROOT) {
      process.env.OPENCLAW_ROUTER_ROOT = ORIGINAL_ROUTER_ROOT;
    } else {
      delete process.env.OPENCLAW_ROUTER_ROOT;
    }
    try { fs.unlinkSync(STATE_FILE); } catch {}
  });

  it("full flow: /router on → restart → coding task → delegate=true", async () => {
    // Phase 1: /router on (before restart)
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    // Phase 2: Simulate gateway restart — new store instance reads from file
    const freshStore = new ExecutionBackendStore();

    // Phase 3: Hook fires with Telegram hookCtx
    const hookCtx = { sessionKey: "agent:main:main", sessionId: "s-restart-1" };
    const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread };
    const scope = extractRuntimeScope(hookCtx, config);

    // Phase 4: Should find thread:default via fallback
    const effective = freshStore.getEffective(
      scope.scopeType,
      scope.scopeId,
      scope.threadId || undefined,
      scope.sessionId || undefined
    );
    expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);

    // Phase 5: Full delegation decision
    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму hello world, запрограмуй",
      config,
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
    expect(decision.healthStatus).toBe("healthy");
    expect(decision.resolvedScopeType).toBe(ScopeType.Thread);
  });

  it("classifier detects Ukrainian coding task", () => {
    const classification = classifyTask("напиши програму hello world, запрограмуй");
    expect(classification.isCodingTask).toBe(true);
    expect(classification.taskType).toBe("coding");
  });

  it("classifier detects English coding task", () => {
    const classification = classifyTask("write a hello world program, code it");
    expect(classification.isCodingTask).toBe(true);
  });

  it("classifier rejects non-coding task", () => {
    const classification = classifyTask("what time is it?");
    expect(classification.isCodingTask).toBe(false);
  });

  it("store persists across store instances (file-based)", () => {
    // First instance writes
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    // Second instance reads from same file
    const store2 = new ExecutionBackendStore();
    const state = store2.get(ScopeType.Thread, "default");
    expect(state?.executionBackend).toBe(ExecutionBackend.RouterBridge);
  });

  it("thread:default fallback works for any threadId", () => {
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    // Simulate various Telegram session keys
    const sessionKeys = [
      "agent:main:main",
      "telegram:428798118",
      "random-session-key",
    ];

    for (const key of sessionKeys) {
      const effective = store.getEffective(
        ScopeType.Thread,
        key,      // scopeId = sessionKey
        key,      // threadId
        undefined // sessionId
      );
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    }
  });
});
