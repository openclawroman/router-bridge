import { describe, it, expect } from "vitest";
import { SubprocessRouterAdapter } from "../src/adapters";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("fallback paths", () => {
  it("falls back when router binary is missing", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "/nonexistent/ai-code-runner",
      routerConfigPath: "/nonexistent/config.json",
      healthCacheTtlMs: 0,
    });

    // Health should fail
    const health = await adapter.health();
    expect(health.healthy).toBe(false);

    // Execute should fail gracefully (ENOENT on spawn)
    const result = await adapter.execute({
      task: "write code",
      taskId: "t-1",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
    });

    expect(result.success).toBe(false);
    expect(result.output).toBeDefined();
    expect(result.output).toContain("not found");
  });

  it("falls back when router exits non-zero", async () => {
    // sh -c ignores extra args after the script; 'false' exits 1
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "sh -c false",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-1",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("falls back when router outputs malformed JSON with non-zero exit", async () => {
    // Temp script that writes garbage to stdout and exits non-zero
    const tmpScript = path.join(os.tmpdir(), "bad-router-" + Date.now() + ".sh");
    fs.writeFileSync(tmpScript, "#!/bin/sh\necho 'not-json-at-all'\nexit 1\n");
    fs.chmodSync(tmpScript, 0o755);

    try {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: tmpScript,
        routerConfigPath: "",
        healthCacheTtlMs: 0,
      });

      const result = await adapter.execute({
        task: "write code",
        taskId: "t-1",
        scopeId: "s-1",
        taskMeta: { type: "coding" },
      });

      // Non-zero exit with non-JSON output → success false
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    } finally {
      fs.unlinkSync(tmpScript);
    }
  });

  it("handles non-JSON output with exit 0 gracefully", async () => {
    // echo ignores extra args; outputs plain text
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "echo 'not valid json'",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-1",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
    });

    // Exit 0 with non-JSON → normalizeResponse returns success:true with raw text
    expect(result.success).toBe(true);
    expect(result.output).toContain("not valid json");
  });

  it("falls back when router times out", async () => {
    // yes runs forever and ignores all extra args
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "yes",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-1",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
      metadata: { timeoutMs: 500 },
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("timed out");
  });

  it("returns healthy with valid router binary via PATH", async () => {
    // echo resolves via PATH, no config path → all checks pass
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "echo",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    const health = await adapter.health();
    expect(health.healthy).toBe(true);
  });

  it("echoes payload through stdin/stdout passthrough (sh -c cat)", async () => {
    // sh -c 'cat' reads stdin and writes to stdout; ignores extra args
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "sh -c cat",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    const result = await adapter.execute({
      task: "write code",
      taskId: "t-1",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
    });

    // cat echoes the full payload JSON
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.output);
    expect(payload.protocol_version).toBe(1);
    expect(payload.task_id).toBe("t-1");
    expect(payload.task).toBe("write code");
  });

  it("handles valid JSON response from router script", async () => {
    // Create a temp script that outputs valid response JSON
    const tmpScript = path.join(os.tmpdir(), "fake-router-" + Date.now() + ".sh");
    fs.writeFileSync(
      tmpScript,
      '#!/bin/sh\necho \'{"success":true,"output":"done","exitCode":0}\'\n',
    );
    fs.chmodSync(tmpScript, 0o755);

    try {
      const adapter = new SubprocessRouterAdapter({
        routerCommand: tmpScript,
        routerConfigPath: "",
        healthCacheTtlMs: 0,
      });

      const result = await adapter.execute({
        task: "write code",
        taskId: "t-1",
        scopeId: "s-1",
        taskMeta: { type: "coding" },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("done");
    } finally {
      fs.unlinkSync(tmpScript);
    }
  });

  it("returns structured error when config path is missing on health", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "echo",
      routerConfigPath: "/nonexistent/config.json",
      healthCacheTtlMs: 0,
    });

    const health = await adapter.health();
    expect(health.healthy).toBe(false);
    expect(health.output).toContain("config_valid");
    expect(health.output).toContain("not found");
  });

  it("getLastHealthError captures last failure reason", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "/nonexistent/binary",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    // Initially null
    expect(adapter.getLastHealthError()).toBeNull();

    // After health check, should capture error
    await adapter.health();
    const lastError = adapter.getLastHealthError();
    expect(lastError).not.toBeNull();
    expect(lastError).toContain("ENOENT");
  });
});
