import { describe, it, expect } from "vitest";
import {
  ExecutionBackend,
  ScopeType,
  DEFAULT_CONFIG,
  type RouterState,
} from "../src/types";

describe("ExecutionBackend enum", () => {
  it("has exactly 3 values", () => {
    const values = Object.values(ExecutionBackend);
    expect(values).toHaveLength(3);
  });

  it("contains expected members", () => {
    expect(ExecutionBackend.Native).toBe("native");
    expect(ExecutionBackend.RouterBridge).toBe("router-bridge");
    expect(ExecutionBackend.RouterAcp).toBe("router-acp");
  });
});

describe("ScopeType enum", () => {
  it("has exactly 3 values", () => {
    const values = Object.values(ScopeType);
    expect(values).toHaveLength(3);
  });

  it("contains expected members", () => {
    expect(ScopeType.Thread).toBe("thread");
    expect(ScopeType.Session).toBe("session");
    expect(ScopeType.Global).toBe("global");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has all required fields", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("backendMode");
    expect(DEFAULT_CONFIG).toHaveProperty("scopeMode");
    expect(DEFAULT_CONFIG).toHaveProperty("routerCommand");
    expect(DEFAULT_CONFIG).toHaveProperty("routerConfigPath");
    expect(DEFAULT_CONFIG).toHaveProperty("fallbackToNativeOnError");
    expect(DEFAULT_CONFIG).toHaveProperty("healthCacheTtlMs");
    expect(DEFAULT_CONFIG).toHaveProperty("targetHarnessId");
  });

  it("has correct types for each field", () => {
    expect(typeof DEFAULT_CONFIG.backendMode).toBe("string");
    expect(typeof DEFAULT_CONFIG.scopeMode).toBe("string");
    expect(typeof DEFAULT_CONFIG.routerCommand).toBe("string");
    expect(typeof DEFAULT_CONFIG.routerConfigPath).toBe("string");
    expect(typeof DEFAULT_CONFIG.fallbackToNativeOnError).toBe("boolean");
    expect(typeof DEFAULT_CONFIG.healthCacheTtlMs).toBe("number");
    expect(typeof DEFAULT_CONFIG.targetHarnessId).toBe("string");
  });

  it("has correct default values", () => {
    expect(DEFAULT_CONFIG.backendMode).toBe(ExecutionBackend.Native);
    expect(DEFAULT_CONFIG.scopeMode).toBe(ScopeType.Thread);
    expect(DEFAULT_CONFIG.fallbackToNativeOnError).toBe(true);
    expect(DEFAULT_CONFIG.healthCacheTtlMs).toBe(30000);
  });
});

describe("RouterState interface", () => {
  it("accepts a valid state object", () => {
    const state: RouterState = {
      executionBackend: ExecutionBackend.RouterBridge,
      scopeType: ScopeType.Thread,
      scopeId: "thread-123",
      threadId: "tid-456",
      sessionId: "sid-789",
      targetHarnessId: "harness-abc",
    };

    expect(state.executionBackend).toBe(ExecutionBackend.RouterBridge);
    expect(state.scopeType).toBe(ScopeType.Thread);
    expect(state.scopeId).toBe("thread-123");
    expect(state.threadId).toBe("tid-456");
    expect(state.sessionId).toBe("sid-789");
    expect(state.targetHarnessId).toBe("harness-abc");
  });

  it("accepts null optional fields", () => {
    const state: RouterState = {
      executionBackend: ExecutionBackend.Native,
      scopeType: ScopeType.Global,
      scopeId: "global",
      threadId: null,
      sessionId: null,
      targetHarnessId: null,
    };

    expect(state.threadId).toBeNull();
    expect(state.sessionId).toBeNull();
    expect(state.targetHarnessId).toBeNull();
  });
});
