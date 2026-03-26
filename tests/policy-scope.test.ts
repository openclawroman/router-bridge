import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { classifyTask, shouldDelegateToExecutionBackend } from "../src/policy";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import { ExecutionBackendStore } from "../src/store";

// Use an isolated temp dir so parallel test files don't stomp our state
const TMP_DIR = path.join(os.tmpdir(), `router-bridge-policy-scope-test-${process.pid}-${Date.now()}`);
const STATE_FILE = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");

const ORIGINAL_ENV = process.env.OPENCLAW_WORKSPACE;

beforeEach(() => {
  // Point the store at our isolated temp dir
  process.env.OPENCLAW_WORKSPACE = TMP_DIR;
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

afterEach(() => {
  // Restore original env
  if (ORIGINAL_ENV) {
    process.env.OPENCLAW_WORKSPACE = ORIGINAL_ENV;
  } else {
    delete process.env.OPENCLAW_WORKSPACE;
  }
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

describe("shouldDelegateToExecutionBackend with getEffective() scope resolution", () => {
  it("delegates when thread scope is set to router-bridge", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "write a function to parse JSON",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Thread,
      { healthy: true, output: "OK", latencyMs: 10 },
      "t-1",  // threadId matches
      null,
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
  });

  it("falls through to session scope when thread scope is not set", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Session, "s-1", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "write a function to parse JSON",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Thread,
      { healthy: true, output: "OK", latencyMs: 10 },
      "t-unknown",  // threadId does not match
      "s-1",        // sessionId matches
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
  });

  it("falls through to global scope when neither thread nor session is set", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "write a function to parse JSON",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
      null,
      null,
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
  });

  it("does not delegate when no scope is set (defaults to native)", async () => {
    const decision = await shouldDelegateToExecutionBackend(
      "write a function to parse JSON",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
      null,
      null,
    );

    expect(decision.delegate).toBe(false);
    expect(decision.backend).toBe(ExecutionBackend.Native);
  });

  it("thread scope overrides session scope", async () => {
    const store = new ExecutionBackendStore();
    // Session says router-bridge
    store.set(ScopeType.Session, "s-1", ExecutionBackend.RouterBridge);
    // But thread says native
    store.set(ScopeType.Thread, "t-1", ExecutionBackend.Native);

    const decision = await shouldDelegateToExecutionBackend(
      "write a function to parse JSON",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Thread,
      { healthy: true, output: "OK", latencyMs: 10 },
      "t-1",
      "s-1",
    );

    // Thread scope (native) should take precedence over session scope (router-bridge)
    expect(decision.delegate).toBe(false);
    expect(decision.backend).toBe(ExecutionBackend.Native);
  });

  it("does not delegate non-coding tasks even when router-bridge is active", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "what is the weather today",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
      null,
      null,
    );

    expect(decision.delegate).toBe(false);
    expect(decision.reason).toContain("chat");
  });

  it("works without threadId/sessionId (backward compatible)", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "write a function to parse JSON",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
      // threadId and sessionId not provided
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
  });
});
