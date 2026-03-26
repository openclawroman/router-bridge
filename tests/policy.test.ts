import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { classifyTask, shouldDelegateToExecutionBackend } from "../src/policy";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import { ExecutionBackendStore } from "../src/store";

// Use an isolated temp dir so parallel test files don't stomp our state
const TMP_DIR = path.join(os.tmpdir(), `router-bridge-policy-test-${process.pid}-${Date.now()}`);
const STATE_FILE = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");

beforeEach(() => {
  // Point the store at our isolated temp dir
  process.env.OPENCLAW_WORKSPACE = TMP_DIR;
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

afterEach(() => {
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

describe("classifyTask", () => {
  it("classifies coding tasks", () => {
    const result = classifyTask("Write a function that calculates the factorial");
    expect(result.isCodingTask).toBe(true);
    expect(result.taskType).toBe("coding");
  });

  it("classifies debugging tasks as coding", () => {
    const result = classifyTask("Fix the bug in auth.ts that causes a crash");
    expect(result.isCodingTask).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("classifies chat/greetings as non-coding", () => {
    const result = classifyTask("Hi, how are you?");
    expect(result.isCodingTask).toBe(false);
  });

  it("classifies knowledge questions as non-coding", () => {
    const result = classifyTask("What is the difference between TCP and UDP?");
    expect(result.isCodingTask).toBe(false);
  });

  it("classifies planning without execution as non-coding", () => {
    const result = classifyTask("Plan the architecture for a microservice system");
    expect(result.isCodingTask).toBe(false);
  });

  it("classifies planning WITH execution as coding", () => {
    const result = classifyTask("Plan and implement a REST API for user management");
    expect(result.isCodingTask).toBe(true);
  });

  it("uses taskMeta.type when available", () => {
    const result = classifyTask({
      task: "something",
      taskId: "t1",
      scopeId: "s1",
      taskMeta: { type: "review" },
    });
    expect(result.isCodingTask).toBe(true);
    expect(result.taskType).toBe("review");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("returns signals explaining the classification", () => {
    const result = classifyTask("Fix the TypeScript bug in the auth module");
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe("shouldDelegateToExecutionBackend", () => {
  it("delegates when backend is router-bridge and task is coding", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "Write a Python function to parse CSV files",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
    );
    expect(decision.delegate).toBe(true);
    expect(decision.reason).toContain("Coding task");
  });

  it("does NOT delegate when backend is native", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.Native);

    const decision = await shouldDelegateToExecutionBackend(
      "Write a Python function",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
    );
    expect(decision.delegate).toBe(false);
    expect(decision.reason).toContain("native");
  });

  it("does NOT delegate for chat tasks even with router-bridge", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "Hi there! How are you today?",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
    );
    expect(decision.delegate).toBe(false);
    expect(decision.reason).toContain("chat");
  });

  it("does NOT delegate when router is unhealthy and fallback is disabled", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "Write a function",
      { ...DEFAULT_CONFIG, fallbackToNativeOnError: false },
      "default",
      ScopeType.Global,
      { healthy: false, output: "connection refused", latencyMs: 5000 },
    );
    expect(decision.delegate).toBe(false);
    expect(decision.reason).toContain("unhealthy");
  });

  it("delegates unhealthy router when fallback is enabled", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "Write a function",
      { ...DEFAULT_CONFIG, fallbackToNativeOnError: true },
      "default",
      ScopeType.Global,
      { healthy: false, output: "connection refused", latencyMs: 5000 },
    );
    expect(decision.delegate).toBe(true);
    expect(decision.reason).toContain("fallback enabled");
  });

  it("does NOT delegate for planning without execution intent", async () => {
    const store = new ExecutionBackendStore();
    store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

    const decision = await shouldDelegateToExecutionBackend(
      "Plan the system architecture and design the data model",
      DEFAULT_CONFIG,
      "default",
      ScopeType.Global,
      { healthy: true, output: "OK", latencyMs: 10 },
    );
    expect(decision.delegate).toBe(false);
  });
});
