import { execSync, spawn } from "child_process";
import type { RouterExecutionAdapter, HealthResult, TaskEnvelope, ExecuteResult } from "./base";

export class SubprocessRouterAdapter implements RouterExecutionAdapter {
  private routerCommand: string;
  private routerConfigPath: string;
  private healthCache: Map<string, { result: HealthResult; timestamp: number }> = new Map();
  private healthCacheTtlMs: number;

  constructor(opts: { routerCommand: string; routerConfigPath: string; healthCacheTtlMs: number }) {
    this.routerCommand = opts.routerCommand;
    this.routerConfigPath = opts.routerConfigPath;
    this.healthCacheTtlMs = opts.healthCacheTtlMs;
  }

  async health(): Promise<HealthResult> {
    // Check cache
    const cached = this.healthCache.get("default");
    if (cached && Date.now() - cached.timestamp < this.healthCacheTtlMs) {
      return cached.result;
    }

    // Run health check
    const start = Date.now();
    try {
      const output = execSync(`${this.routerCommand} --health`, {
        timeout: 10000,
        encoding: "utf-8",
      });
      const result: HealthResult = {
        healthy: true,
        output: output.trim(),
        latencyMs: Date.now() - start,
      };
      this.healthCache.set("default", { result, timestamp: Date.now() });
      return result;
    } catch (err: any) {
      const result: HealthResult = {
        healthy: false,
        output: err.message || String(err),
        latencyMs: Date.now() - start,
      };
      this.healthCache.set("default", { result, timestamp: Date.now() });
      return result;
    }
  }

  async execute(envelope: TaskEnvelope): Promise<ExecuteResult> {
    const start = Date.now();
    try {
      // Build command with task input via stdin
      const child = spawn(this.routerCommand, ["--config", this.routerConfigPath, "route"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Write task envelope to stdin
      child.stdin.write(JSON.stringify(envelope));
      child.stdin.end();

      // Collect output
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const exitCode = await new Promise<number>((resolve) => {
        child.on("error", () => resolve(1));
        child.on("close", (code) => resolve(code ?? 1));
      });

      return {
        success: exitCode === 0,
        output: stdout || stderr,
        exitCode,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        output: err.message || String(err),
        exitCode: 1,
        durationMs: Date.now() - start,
      };
    }
  }

  supportsPersistentSession(): boolean {
    return false; // subprocess is one-shot
  }

  async closeScope(_scopeId: string): Promise<void> {
    // No-op for subprocess — nothing to clean up
  }
}
