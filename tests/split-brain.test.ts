import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionBackendStore } from "../src/store";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("split-brain resolution", () => {
  let store: ExecutionBackendStore;
  const TMP_DIR = path.join(os.tmpdir(), `router-bridge-splitbrain-${process.pid}-${Date.now()}`);
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

  it("effective backend resolves from scoped store when global is native", () => {
    // Global config is native
    const config = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native };

    // Thread override is router-bridge
    store.set(ScopeType.Thread, "split-test-1", ExecutionBackend.RouterBridge, "split-test-1");

    // Resolve effective backend — scoped store should win over global
    const effective = store.getEffective(ScopeType.Global, "default", "split-test-1");
    const effectiveBackend = effective?.executionBackend || config.backendMode;
    expect(effectiveBackend).toBe("router-bridge");
  });

  it("falls back to global config when no scoped override", () => {
    const config = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native };

    // No scoped override — getEffective returns default native
    const effective = store.getEffective(ScopeType.Global, "default");
    const effectiveBackend = effective?.executionBackend || config.backendMode;
    expect(effectiveBackend).toBe("native");
  });

  it("scoped native overrides global router-bridge via getEffective", () => {
    const config = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.RouterBridge };

    // Thread-level native override
    store.set(ScopeType.Thread, "split-test-2", ExecutionBackend.Native, "split-test-2");

    // Thread state should take precedence over global default
    const effective = store.getEffective(ScopeType.Global, "default", "split-test-2");
    const effectiveBackend = effective?.executionBackend || config.backendMode;
    expect(effectiveBackend).toBe("native");
  });

  it("store.getEffective returns correct override from thread scope", () => {
    store.set(ScopeType.Thread, "tid-300", ExecutionBackend.RouterBridge, "tid-300");

    const effective = store.getEffective(ScopeType.Global, "default", "tid-300");
    expect(effective.executionBackend).toBe("router-bridge");
  });

  it("store.getEffective returns correct override from session scope", () => {
    store.set(ScopeType.Session, "sess-300", ExecutionBackend.RouterBridge);

    const effective = store.getEffective(ScopeType.Global, "default", undefined, "sess-300");
    expect(effective.executionBackend).toBe("router-bridge");
  });

  it("thread scope takes priority over session scope in getEffective", () => {
    store.set(ScopeType.Thread, "tid-400", ExecutionBackend.RouterBridge, "tid-400");
    store.set(ScopeType.Session, "sid-400", ExecutionBackend.Native);

    // Thread should win over session
    const effective = store.getEffective(ScopeType.Global, "default", "tid-400", "sid-400");
    expect(effective.executionBackend).toBe("router-bridge");
  });

  it("hook resolution pattern: global native + thread router-bridge = delegate", () => {
    // Simulate what the hook does
    const config = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native };

    // Thread sets router-bridge
    store.set(ScopeType.Thread, "hook-test", ExecutionBackend.RouterBridge, "hook-test");

    // Hook logic: resolve effective backend
    const effectiveState = store.getEffective(
      config.scopeMode,
      "hook-test",
      "hook-test",
      undefined,
    );
    const effectiveBackend = effectiveState?.executionBackend || config.backendMode;

    // The bug was: old code checked config.backendMode ("native") and bailed
    // Fix: check effectiveBackend ("router-bridge") instead
    expect(effectiveBackend).toBe("router-bridge");
    // So the hook should NOT bail out — it should proceed to delegation
    expect(effectiveBackend).not.toBe("native");
  });

  it("hook resolution pattern: global native + no override = bail", () => {
    const config = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native };

    // No scoped override
    const effectiveState = store.getEffective(
      config.scopeMode,
      "no-override-scope",
      undefined,
      undefined,
    );
    const effectiveBackend = effectiveState?.executionBackend || config.backendMode;

    // No override, falls back to global "native" — hook should bail
    expect(effectiveBackend).toBe("native");
    expect(effectiveBackend).not.toBe("router-bridge");
  });
});
