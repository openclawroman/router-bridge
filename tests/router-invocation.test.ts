import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SubprocessRouterAdapter } from "../src/adapters";
import { runDoctor } from "../src/doctor";
import { takeSnapshot } from "../src/snapshot";
import { DEFAULT_CONFIG } from "../src/types";
import { handleRouterInitConfig } from "../src/commands";
import { recordMetricEvent } from "../src/metrics";
import { resolveRouterInvocation, describeWorkspacePath } from "../src/router-invocation";

function withTempHome(): { homeDir: string; cleanup: () => void } {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "router-bridge-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  return {
    homeDir,
    cleanup: () => {
      if (previousHome) process.env.HOME = previousHome;
      else delete process.env.HOME;
      fs.rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

describe("router invocation", () => {
  it("expands ~ consistently across adapter, doctor, snapshot, and commands", async () => {
    const { homeDir, cleanup } = withTempHome();
    const binDir = path.join(homeDir, ".openclaw", "router", "bin");
    const configDir = path.join(homeDir, ".openclaw", "router", "config");
    const runnerPath = path.join(binDir, "ai-code-runner");
    const configPath = path.join(configDir, "router.config.json");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      runnerPath,
      [
        "#!/usr/bin/env python3",
        "import json, sys",
        "if '--health' in sys.argv:",
        "    print(json.dumps({'healthy': True}))",
        "else:",
        "    json.load(sys.stdin)",
        "    print(json.dumps({'success': True, 'final_summary': 'done', 'trace_id': 'trace-123'}))",
      ].join("\n"),
    );
    fs.chmodSync(runnerPath, 0o755);
    fs.writeFileSync(configPath, '{"version":1,"ok":true}');

    try {
      const config = {
        ...DEFAULT_CONFIG,
        routerCommand: "python3 ~/.openclaw/router/bin/ai-code-runner",
        routerConfigPath: "~/.openclaw/router/config/router.config.json",
        healthCacheTtlMs: 0,
      };

      const invocation = resolveRouterInvocation(config);
      expect(invocation.baseArgs[0]).toBe(runnerPath);
      expect(invocation.configPath).toBe(configPath);

      const adapter = new SubprocessRouterAdapter({
        routerCommand: config.routerCommand,
        routerConfigPath: config.routerConfigPath,
        healthCacheTtlMs: 0,
      });
      const health = await adapter.health();
      expect(health.healthy).toBe(true);

      const result = await adapter.execute({
        task: "write code",
        taskId: "task-1",
        scopeId: "scope-1",
        taskMeta: { type: "coding" },
        trace: {
          bridgeRequestId: "bridge-1",
          origin: "router-bridge",
          promptSha256: "abc",
          emittedAt: new Date().toISOString(),
        },
      });
      expect(result.success).toBe(true);
      expect(result.traceId).toBe("trace-123");

      const doctorChecks = runDoctor(config);
      expect(doctorChecks.find(c => c.name === "router_binary")?.passed).toBe(true);
      expect(doctorChecks.find(c => c.name === "config_exists")?.passed).toBe(true);

      const snapshot = takeSnapshot(config);
      expect(snapshot.routerConfigContents).toContain('"ok":true');

      const initConfig = {
        ...DEFAULT_CONFIG,
        routerConfigPath: "~/.openclaw/router/config/generated.json",
      };
      const initResult = handleRouterInitConfig({}, initConfig);
      expect(initResult.text).toContain("Config created");
      expect(fs.existsSync(path.join(configDir, "generated.json"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("does not mask a missing workspace path", () => {
    const diagnostics = describeWorkspacePath("/definitely/missing/workspace");
    expect(diagnostics.exists).toBe(false);
    expect(diagnostics.isDirectory).toBe(false);
    expect(diagnostics.resolvedPath).toContain("/definitely/missing/workspace");
  });

  it("writes correlated bridge metric events by bridge_request_id", () => {
    const { homeDir, cleanup } = withTempHome();
    try {
      recordMetricEvent("delegate_request", { bridge_request_id: "bridge-42", cwd_exists: false });
      recordMetricEvent("delegate_result", { bridge_request_id: "bridge-42", success: false });

      const metricsPath = path.join(homeDir, ".openclaw", "router", "runtime", "bridge", "metrics.jsonl");
      const entries = fs.readFileSync(metricsPath, "utf-8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));

      expect(entries[0].event).toBe("delegate_request");
      expect(entries[1].event).toBe("delegate_result");
      expect(entries[0].bridge_request_id).toBe("bridge-42");
      expect(entries[1].bridge_request_id).toBe("bridge-42");
      expect(entries[0].cwd_exists).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("flags a missing script target even when the interpreter exists", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: "python3 /definitely/missing/ai-code-runner",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    const health = await adapter.health();
    expect(health.healthy).toBe(false);
    expect(health.output).toContain("binary_exists");
    expect(health.output).toContain("/definitely/missing/ai-code-runner");
  });
});
