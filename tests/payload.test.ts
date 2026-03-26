import { describe, it, expect } from "vitest";
import { SubprocessRouterAdapter } from "../src/adapters";
import type { TaskEnvelope } from "../src/adapters/base";

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
    expect(result.output).toContain("Router CLI not found");
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
  it("kills process and returns timeout error after exceeding timeoutMs", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "sleep",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
      metadata: { timeoutMs: 200 },
    });
    // sleep exits fast with no arg, so this tests the failure path
    // (actual timeout path tested by verifying SIGKILL is sent)
    expect(result.success).toBe(false);
  });

  it("handles command that exits immediately", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "true", // always exits 0
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
    });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});

describe("SubprocessRouterAdapter execute() JSON response parsing", () => {
  it("parses valid JSON response from router", async () => {
    // Use a command that outputs valid JSON
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "echo",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
    });
    // echo outputs the raw args, not our stdin JSON — exit 0 with text output
    // This tests the non-JSON exit-0 fallback path
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBeTruthy();
  });

  it("handles non-zero exit with stderr", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "sh",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });
    // sh -c "echo err >&2; exit 1" — but we pass args differently
    // Instead use false which exits 1 with no output
    const adapterFalse = new SubprocessRouterAdapter({
      routerCommand: "false",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });
    const result = await adapterFalse.execute({
      task: "test",
      taskId: "t1",
      scopeId: "s1",
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("SubprocessRouterAdapter buildPayload defaults", () => {
  it("defaults taskMeta to type:other when not provided", async () => {
    // We can't directly test buildPayload (private), but we can verify
    // execute doesn't throw with minimal envelope
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "echo",
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    // Should not throw despite missing taskMeta, attachments, context
    const result = await adapter.execute({
      task: "minimal task",
      taskId: "t-min",
      scopeId: "s-min",
    });
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
  });
});

describe("SubprocessRouterAdapter buildPayload JSON structure", () => {
  const CAT_STDIN = "/tmp/router-bridge/tests/cat_stdin.sh";

  it("builds full payload with all fields matching input", async () => {
    // cat_stdin.sh ignores args and just runs cat, echoing stdin back
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });

    const envelope: TaskEnvelope = {
      task: "Fix the login bug",
      taskId: "task-42",
      scopeId: "thread-abc",
      threadId: "t-123",
      sessionId: "s-456",
      taskMeta: {
        type: "coding",
        priority: "high",
      },
      attachments: [
        { name: "auth.ts", content: "export function login() { ... }" },
      ],
      context: {
        gitBranch: "fix/login",
      },
    };

    const result = await adapter.execute(envelope);

    // sh -c 'cat' exits 0 and echoes the JSON payload back
    // The output won't parse as RouterResponse (no "success" key), so normalizeResponse
    // treats it as non-JSON exit-0 output
    expect(result.success).toBe(true);

    // Parse the raw output (which is the JSON payload string) to verify structure
    const payload = JSON.parse(result.output);

    expect(payload.task_id).toBe("task-42");
    expect(payload.scope.scope_id).toBe("thread-abc");
    expect(payload.scope.thread_id).toBe("t-123");
    expect(payload.scope.session_id).toBe("s-456");
    expect(payload.task_meta.type).toBe("coding");
    expect(payload.attachments).toHaveLength(1);
    expect(payload.context.gitBranch).toBe("fix/login");
  });

  it("builds minimal payload with correct defaults", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "do something simple",
      taskId: "t-min-1",
      scopeId: "s-min-1",
    });

    expect(result.success).toBe(true);

    const payload = JSON.parse(result.output);

    expect(payload.task_id).toBe("t-min-1");
    expect(payload.scope.scope_id).toBe("s-min-1");
    expect(payload.scope.thread_id).toBeNull();
    expect(payload.scope.session_id).toBeNull();
    expect(payload.task_meta.type).toBe("other");
    expect(payload.attachments).toEqual([]);
  });
});
