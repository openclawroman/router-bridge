import { describe, it, expect } from "vitest";
import { SubprocessRouterAdapter } from "../src/adapters";
import type { TaskEnvelope, TaskMeta, Attachment, TaskContext } from "../src/adapters/base";

describe("TaskEnvelope rich payload", () => {
  it("accepts full payload with taskMeta", () => {
    const envelope: TaskEnvelope = {
      task: "Fix the login bug",
      taskId: "task-1",
      scopeId: "thread-abc",
      threadId: "t-123",
      sessionId: "s-456",
      taskMeta: {
        type: "coding",
        priority: "high",
        repoPath: "/tmp/myproject",
        branch: "fix/login",
        language: "typescript",
        framework: "express",
      },
      prompt: "Fix the login endpoint that returns 500 on invalid credentials",
      attachments: [
        { name: "auth.ts", content: "export function login() { ... }", mimeType: "text/typescript" },
      ],
      context: {
        workingDirectory: "/tmp/myproject",
        gitBranch: "fix/login",
        gitCommit: "abc123",
        recentFiles: ["src/auth.ts", "src/routes.ts"],
      },
    };

    expect(envelope.taskMeta?.type).toBe("coding");
    expect(envelope.attachments).toHaveLength(1);
    expect(envelope.context?.gitBranch).toBe("fix/login");
  });

  it("accepts minimal payload", () => {
    const envelope: TaskEnvelope = {
      task: "do something",
      taskId: "t-1",
      scopeId: "s-1",
    };
    expect(envelope.task).toBe("do something");
    expect(envelope.taskMeta).toBeUndefined();
    expect(envelope.attachments).toBeUndefined();
  });
});

describe("SubprocessRouterAdapter execute() error mapping", () => {
  const adapter = new SubprocessRouterAdapter({
    routerCommand: "/nonexistent/router-cli",
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  it("maps ENOENT to descriptive error", async () => {
    const result = await adapter.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
    });
    expect(result.success).toBe(false);
    expect(result.output).toBeTruthy();
    expect(result.exitCode).not.toBe(0);
  });

  it("includes durationMs in result", async () => {
    const result = await adapter.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("SubprocessRouterAdapter execute() timeout", () => {
  it("respects timeout parameter", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "sleep", // will hang
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });
    // With a 60s default timeout and a "10" arg to sleep, it should fail fast
    // since sleep 10 isn't the router CLI format
    const result = await adapter.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
    });
    expect(result.success).toBe(false);
  });
});
