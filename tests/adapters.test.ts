import { describe, it, expect } from "vitest";
import { SubprocessRouterAdapter, AcpRouterAdapter } from "../src/adapters";
import type { TaskEnvelope } from "../src/adapters";

describe("RouterExecutionAdapter interface", () => {
  describe("SubprocessRouterAdapter", () => {
    it("supportsPersistentSession returns false", () => {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        healthCacheTtlMs: 30000,
      });
      expect(adapter.supportsPersistentSession()).toBe(false);
    });

    it("closeScope is a no-op", async () => {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        healthCacheTtlMs: 30000,
      });
      // Should not throw
      await adapter.closeScope("scope-123");
    });

    it("health() returns unhealthy for invalid command", async () => {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: "/nonexistent/binary",
        routerConfigPath: "/tmp/test.yaml",
        healthCacheTtlMs: 0,
      });
      const result = await adapter.health();
      expect(result.healthy).toBe(false);
      expect(result.output).toBeTruthy();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("health() caches results within TTL", async () => {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: "/nonexistent/binary",
        routerConfigPath: "/tmp/test.yaml",
        healthCacheTtlMs: 60000,
      });
      const r1 = await adapter.health();
      const r2 = await adapter.health();
      // Same result from cache
      expect(r1.healthy).toBe(r2.healthy);
      expect(r1.output).toBe(r2.output);
    });

    it("execute() returns failure for nonexistent command", async () => {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: "/nonexistent/binary",
        routerConfigPath: "/tmp/test.yaml",
        healthCacheTtlMs: 0,
      });
      const envelope: TaskEnvelope = {
        task: "test task",
        taskId: "task-1",
        scopeId: "scope-1",
      };
      const result = await adapter.execute(envelope);
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("AcpRouterAdapter", () => {
    it("supportsPersistentSession returns true", () => {
      const adapter = new AcpRouterAdapter({ targetHarnessId: "harness-1" });
      expect(adapter.supportsPersistentSession()).toBe(true);
    });

    it("health() returns not implemented", async () => {
      const adapter = new AcpRouterAdapter({ targetHarnessId: "harness-1" });
      const result = await adapter.health();
      expect(result.healthy).toBe(false);
      expect(result.output).toContain("Phase 2");
    });

    it("execute() returns not implemented", async () => {
      const adapter = new AcpRouterAdapter({ targetHarnessId: "harness-1" });
      const envelope: TaskEnvelope = {
        task: "test",
        taskId: "t1",
        scopeId: "s1",
      };
      const result = await adapter.execute(envelope);
      expect(result.success).toBe(false);
      expect(result.output).toContain("Phase 2");
      expect(result.exitCode).toBe(1);
    });

    it("closeScope is a no-op", async () => {
      const adapter = new AcpRouterAdapter({ targetHarnessId: "harness-1" });
      await adapter.closeScope("scope-1");
      // Should not throw
    });
  });

  describe("createAdapter factory", () => {
    it("creates SubprocessRouterAdapter for router-bridge mode", async () => {
      const { createAdapter } = await import("../src/adapters/factory");
      const adapter = createAdapter({
        backendMode: "router-bridge",
        scopeMode: "thread",
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        fallbackToNativeOnError: true,
        healthCacheTtlMs: 30000,
      } as any);
      expect(adapter.supportsPersistentSession()).toBe(false);
    });

    it("creates AcpRouterAdapter for router-acp mode", async () => {
      const { createAdapter } = await import("../src/adapters/factory");
      const adapter = createAdapter({
        backendMode: "router-acp",
        scopeMode: "thread",
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        fallbackToNativeOnError: true,
        healthCacheTtlMs: 30000,
        targetHarnessId: "harness-1",
      } as any);
      expect(adapter.supportsPersistentSession()).toBe(true);
    });

    it("creates NativeAdapter for native mode", async () => {
      const { createAdapter } = await import("../src/adapters/factory");
      const adapter = createAdapter({
        backendMode: "native",
        scopeMode: "thread",
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        fallbackToNativeOnError: true,
        healthCacheTtlMs: 30000,
      } as any);
      const health = await adapter.health();
      expect(health.healthy).toBe(true);
      expect(health.output).toContain("native");
    });

    it("throws for unknown backendMode", async () => {
      const { createAdapter } = await import("../src/adapters/factory");
      expect(() => createAdapter({
        backendMode: "invalid-mode",
        scopeMode: "thread",
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        fallbackToNativeOnError: true,
        healthCacheTtlMs: 30000,
      } as any)).toThrow("Unknown backendMode");
    });

    it("creates AcpRouterAdapter with targetHarnessId and health returns Phase 2", async () => {
      const { createAdapter } = await import("../src/adapters/factory");
      const adapter = createAdapter({
        backendMode: "router-acp",
        scopeMode: "thread",
        routerCommand: "echo",
        routerConfigPath: "/tmp/test.yaml",
        fallbackToNativeOnError: true,
        healthCacheTtlMs: 30000,
        targetHarnessId: "my-harness-42",
      } as any);
      const health = await adapter.health();
      expect(health.healthy).toBe(false);
      expect(health.output).toContain("Phase 2");
    });
  });
});
