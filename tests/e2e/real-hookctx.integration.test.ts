import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionBackendStore } from "../../src/store";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../../src/types";
import { extractRuntimeScope } from "../../src/scope";
import { shouldDelegateToExecutionBackend } from "../../src/policy";

describe("Real Telegram hookCtx → thread:default delegation", () => {
  let store: ExecutionBackendStore;
  
  beforeEach(() => {
    store = new ExecutionBackendStore();
    // Clean state file
    const fs = require("fs");
    const statePath = require("path").join(__dirname, "../../runtime/bridge/state.json");
    try { fs.unlinkSync(statePath); } catch {}
  });

  it("extractRuntimeScope resolves Telegram sessionKey as scopeId", () => {
    const ctx = { sessionKey: "agent:main:main", sessionId: "s-real-1" };
    const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread };
    const scope = extractRuntimeScope(ctx, config);

    expect(scope.scopeType).toBe(ScopeType.Thread);
    expect(scope.threadId).toBe("agent:main:main");
    expect(scope.sessionId).toBe("s-real-1");
    expect(scope.scopeId).toBe("agent:main:main");
  });

  it("getEffective finds thread:default when scopeId=agent:main:main", () => {
    // Simulate /router on writing thread:default
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    // Simulate Telegram hookCtx: sessionKey = "agent:main:main"
    const ctx = { sessionKey: "agent:main:main", sessionId: "s-real-1" };
    const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread };
    const scope = extractRuntimeScope(ctx, config);

    // getEffective should fall back to thread:default
    const effective = store.getEffective(
      scope.scopeType,
      scope.scopeId,
      scope.threadId || undefined,
      scope.sessionId || undefined
    );
    expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
  });

  it("shouldDelegateToExecutionBackend returns delegate=true for Telegram session", async () => {
    // Set up store with thread:default
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "default", ExecutionBackend.RouterBridge);

    const ctx = { sessionKey: "agent:main:main", sessionId: "s-real-1" };
    const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread, backendMode: ExecutionBackend.RouterBridge };
    const scope = extractRuntimeScope(ctx, config);

    const decision = await shouldDelegateToExecutionBackend(
      "напиши програму hello world",
      config,
      scope.scopeId,
      scope.scopeType,
      undefined,
      scope.threadId,
      scope.sessionId
    );
    
    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
  });
  
  it("extractRuntimeScope handles missing sessionKey gracefully", () => {
    const ctx = {};
    const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread };
    const scope = extractRuntimeScope(ctx, config);

    expect(scope.scopeId).toBe("default");
    expect(scope.threadId).toBeNull();
    expect(scope.sessionId).toBeNull();
  });
  
  it("extractRuntimeScope handles session-scoped mode", () => {
    const ctx = { sessionKey: "tg-123", sessionId: "sess-456" };
    const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session };
    const scope = extractRuntimeScope(ctx, config);

    expect(scope.scopeType).toBe(ScopeType.Session);
    expect(scope.scopeId).toBe("sess-456");
  });
});
