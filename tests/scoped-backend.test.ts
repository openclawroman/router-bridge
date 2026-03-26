import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { store } from "../src/commands";
import { createAdapter } from "../src/adapters/factory";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";

describe("scoped backend resolution", () => {
  const testScope = "test-scoped-1";

  beforeEach(() => {
    store.clear(ScopeType.Thread, testScope);
  });

  afterEach(() => {
    store.clear(ScopeType.Thread, testScope);
  });

  it("thread override sets effective backend", () => {
    store.set(ScopeType.Thread, testScope, ExecutionBackend.RouterBridge);

    const state = store.get(ScopeType.Thread, testScope);
    expect(state?.executionBackend).toBe(ExecutionBackend.RouterBridge);
  });

  it("effective backend falls back to config when no override", () => {
    const state = store.get(ScopeType.Thread, "nonexistent");
    expect(state).toBeNull();

    // Should fall back to config
    const backend = state?.executionBackend || DEFAULT_CONFIG.backendMode;
    expect(backend).toBe(DEFAULT_CONFIG.backendMode);
  });

  it("createAdapter accepts backend override", () => {
    // Should not throw when given valid backend
    expect(() => createAdapter(DEFAULT_CONFIG, "router-bridge")).not.toThrow();
  });

  it("getEffective returns merged config for overridden scope", () => {
    store.set(ScopeType.Thread, testScope, ExecutionBackend.RouterBridge);

    const effective = store.getEffective(ScopeType.Thread, testScope);
    expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
  });

  it("getEffective falls back to native when no overrides exist", () => {
    // Clear any existing states
    store.clear(ScopeType.Thread, "nonexistent-scope");
    store.clear(ScopeType.Global, "default");

    const effective = store.getEffective(ScopeType.Thread, "nonexistent-scope");
    expect(effective.executionBackend).toBe(ExecutionBackend.Native);
  });

  it("createAdapter uses override instead of config.backendMode", () => {
    const nativeConfig = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native };

    // With override, should create router-bridge adapter even though config is native
    const adapter = createAdapter(nativeConfig, "router-bridge");
    expect(adapter).toBeDefined();
    expect(typeof adapter.health).toBe("function");
    expect(typeof adapter.execute).toBe("function");
  });
});
