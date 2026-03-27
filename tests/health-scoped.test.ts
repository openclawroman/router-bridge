import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { shouldDelegateToExecutionBackend } from "../src/policy";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import { ExecutionBackendStore } from "../src/store";

// Use an isolated temp dir so parallel test files don't stomp our state
const TMP_DIR = path.join(os.tmpdir(), `router-bridge-health-scoped-${process.pid}-${Date.now()}`);
const originalEnv = process.env.OPENCLAW_ROUTER_ROOT;

beforeEach(() => {
  process.env.OPENCLAW_ROUTER_ROOT = path.join(TMP_DIR, "router");
  fs.mkdirSync(path.join(TMP_DIR, "router", "runtime", "bridge"), { recursive: true });
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

describe("shouldDelegateToExecutionBackend with scoped backend", () => {
  it("health check uses effective scoped backend, not global config", async () => {
    // Global config = native
    const config = {
      ...DEFAULT_CONFIG,
      backendMode: ExecutionBackend.Native,
      fallbackToNativeOnError: true,
    };

    const store = new ExecutionBackendStore();

    // Scoped state = router-bridge for a specific thread
    store.set(ScopeType.Thread, "test-thread-1", ExecutionBackend.RouterBridge, "test-thread-1");

    // Call shouldDelegateToExecutionBackend with the thread scope
    // This is a coding task so it will reach the health check path
    const decision = await shouldDelegateToExecutionBackend(
      "Write a function that computes fibonacci",
      config,
      "test-thread-1",
      ScopeType.Thread,
      undefined, // no pre-computed health — forces inline check
      "test-thread-1",
    );

    // The backend resolved from the scoped store should be router-bridge
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);

    // The health check should have been performed against router-bridge (SubprocessRouterAdapter)
    // not native. Since the subprocess adapter will fail (no real router binary),
    // with fallbackToNativeOnError=true we should still delegate.
    // The key assertion: backend is NOT native — it resolved the scoped override.
    expect(decision.backend).not.toBe(ExecutionBackend.Native);
  });

  it("when no scoped override, health check uses global config (native)", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      backendMode: ExecutionBackend.Native,
    };

    // No scoped override — should bail before health check
    const decision = await shouldDelegateToExecutionBackend(
      "Write a function that computes fibonacci",
      config,
      "no-scope",
      ScopeType.Global,
    );

    expect(decision.delegate).toBe(false);
    expect(decision.backend).toBe(ExecutionBackend.Native);
    expect(decision.reason).toContain("not router-bridge");
  });

  it("scoped router-bridge with pre-computed healthy health delegates", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      backendMode: ExecutionBackend.Native,
    };

    const store = new ExecutionBackendStore();
    store.set(ScopeType.Session, "sess-health", ExecutionBackend.RouterBridge);

    // Provide pre-computed health to avoid needing a real router binary
    // Note: threadId must be undefined so getEffective checks session scope,
    // not thread scope (thread has higher priority)
    const decision = await shouldDelegateToExecutionBackend(
      "Write a function that implements a sorting algorithm",
      config,
      "sess-health",
      ScopeType.Session,
      { healthy: true, output: "router OK", latencyMs: 5 },
      undefined, // no threadId — so session scope is checked
      "sess-health",
    );

    expect(decision.delegate).toBe(true);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
    expect(decision.healthStatus).toBe("healthy");
  });

  it("scoped router-bridge with pre-computed unhealthy health and fallback disabled rejects", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      backendMode: ExecutionBackend.Native,
      fallbackToNativeOnError: false,
    };

    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "tid-unhealthy", ExecutionBackend.RouterBridge, "tid-unhealthy");

    const decision = await shouldDelegateToExecutionBackend(
      "Fix the null pointer bug in auth.ts",
      config,
      "tid-unhealthy",
      ScopeType.Thread,
      { healthy: false, output: "router process crashed", latencyMs: 0 },
      "tid-unhealthy",
    );

    expect(decision.delegate).toBe(false);
    expect(decision.backend).toBe(ExecutionBackend.RouterBridge);
    expect(decision.healthStatus).toBe("unavailable");
    expect(decision.reason).toContain("unhealthy");
  });

  it("non-coding task does not reach health check even with scoped router-bridge", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      backendMode: ExecutionBackend.Native,
    };

    const store = new ExecutionBackendStore();
    store.set(ScopeType.Thread, "tid-chat", ExecutionBackend.RouterBridge, "tid-chat");

    const decision = await shouldDelegateToExecutionBackend(
      "What's the weather today?",
      config,
      "tid-chat",
      ScopeType.Thread,
      undefined,
      "tid-chat",
    );

    expect(decision.delegate).toBe(false);
    expect(decision.healthStatus).toBe("not_checked");
    expect(decision.reason).toContain("chat");
  });
});
