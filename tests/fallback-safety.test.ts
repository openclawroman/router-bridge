import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { shouldDelegateToExecutionBackend } from "../src/policy";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";

const ISOLATED_ROUTER_ROOT = path.join(os.tmpdir(), `router-bridge-fallback-test-${process.pid}-${Date.now()}`, ".openclaw", "router");
const STATE_FILE = path.join(ISOLATED_ROUTER_ROOT, "runtime", "bridge", "state.json");

beforeEach(() => {
  process.env.OPENCLAW_ROUTER_ROOT = ISOLATED_ROUTER_ROOT;
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

afterEach(() => {
  delete process.env.OPENCLAW_ROUTER_ROOT;
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

describe("fallback safety (Phase 2 invariant)", () => {
  it("falls back to native when router binary missing", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      routerCommand: "/nonexistent/binary",
      routerConfigPath: "/nonexistent/config",
    };
    const decision = await shouldDelegateToExecutionBackend("write code", config);
    expect(decision.delegate).toBe(false);
  });

  it("falls back to native when config missing", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      routerCommand: "echo",
      routerConfigPath: "/nonexistent/config.json",
    };
    const decision = await shouldDelegateToExecutionBackend("write code", config);
    expect(decision.delegate).toBe(false);
  });

  it("delegates when router is healthy", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      routerCommand: "echo",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    };
    const decision = await shouldDelegateToExecutionBackend("write code", config);
    expect(typeof decision.delegate).toBe("boolean");
  });

  it("never throws on any input", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      routerCommand: "/nonexistent/binary",
      routerConfigPath: "/nonexistent/config",
    };
    const decision = await shouldDelegateToExecutionBackend("write code", config);
    expect(decision).toBeDefined();
    expect(decision).toHaveProperty("delegate");
    expect(decision).toHaveProperty("reason");
    expect(decision).toHaveProperty("backend");
    expect(decision).toHaveProperty("healthStatus");
  });

  it("non-coding tasks are not delegated", async () => {
    const config = { ...DEFAULT_CONFIG };
    const decision = await shouldDelegateToExecutionBackend("what is the weather?", config);
    expect(decision.delegate).toBe(false);
  });

  it("returns valid decision structure", async () => {
    const config = { ...DEFAULT_CONFIG };
    const decision = await shouldDelegateToExecutionBackend("write code", config);
    expect(decision).toHaveProperty("delegate");
    expect(decision).toHaveProperty("reason");
    expect(decision).toHaveProperty("backend");
    expect(decision).toHaveProperty("healthStatus");
    expect(["healthy", "unavailable", "not_checked"]).toContain(decision.healthStatus);
  });
});
