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
    return new Promise((resolve) => {
      let settled = false;

      const done = (result: ExecuteResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      try {
        const child = spawn(this.routerCommand, ["--config", this.routerConfigPath, "route"], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Write task envelope to stdin with EPIPE guard
        try {
          child.stdin.write(JSON.stringify(envelope));
          child.stdin.end();
        } catch {
          // EPIPE — child already exited, will be handled by error/close events
        }

        // Collect output
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        child.on("error", () => {
          done({
            success: false,
            output: stderr || stdout || "Process spawn failed",
            exitCode: 1,
            durationMs: Date.now() - start,
          });
        });

        child.on("close", (code) => {
          done({
            success: code === 0,
            output: stdout || stderr,
            exitCode: code ?? 1,
            durationMs: Date.now() - start,
          });
        });
      } catch (err: any) {
        done({
          success: false,
          output: err.message || String(err),
          exitCode: 1,
          durationMs: Date.now() - start,
        });
      }
    });
  }

  supportsPersistentSession(): boolean {
    return false; // subprocess is one-shot
  }

  async closeScope(_scopeId: string): Promise<void> {
    // No-op for subprocess — nothing to clean up
  }
}
