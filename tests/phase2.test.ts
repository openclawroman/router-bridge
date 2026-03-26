import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, ExecutionBackend, ScopeType } from "../src/types";

describe("Phase 2 migration seam", () => {
  it("DEFAULT_CONFIG has threadBindingMode", () => {
    expect(DEFAULT_CONFIG.threadBindingMode).toBe("per-thread");
  });

  it("DEFAULT_CONFIG has acpSessionKey as null", () => {
    expect(DEFAULT_CONFIG.acpSessionKey).toBeNull();
  });

  it("ExecutionBackend enum has all three modes", () => {
    expect(ExecutionBackend.Native).toBe("native");
    expect(ExecutionBackend.RouterBridge).toBe("router-bridge");
    expect(ExecutionBackend.RouterAcp).toBe("router-acp");
  });

  it("Phase 2 config fields are in the correct types", () => {
    // threadBindingMode should be a string enum
    const validModes = ["per-thread", "per-session", "free"];
    expect(validModes).toContain(DEFAULT_CONFIG.threadBindingMode);
  });

  it("createAdapter handles all three backend modes", async () => {
    const { createAdapter } = await import("../src/adapters/factory");

    // Native
    const native = createAdapter({ ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native });
    expect(native).toBeDefined();
    const nativeHealth = await native.health();
    expect(nativeHealth.healthy).toBe(true);

    // Router-bridge
    const bridge = createAdapter({ ...DEFAULT_CONFIG, backendMode: ExecutionBackend.RouterBridge });
    expect(bridge).toBeDefined();

    // Router-acp
    const acp = createAdapter({ ...DEFAULT_CONFIG, backendMode: ExecutionBackend.RouterAcp });
    expect(acp).toBeDefined();
  });
});
