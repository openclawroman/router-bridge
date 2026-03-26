import { execSync, spawn } from "child_process";
import * as fs from "fs";
import type { RouterExecutionAdapter, HealthResult, HealthCheckResult, TaskEnvelope, ExecuteResult, TaskMeta, Attachment, TaskContext } from "./base";

/** Payload sent to the router CLI via stdin */
interface RouterPayload {
  task: string;
  task_id: string;
  task_meta: TaskMeta;
  prompt: string;
  attachments: Attachment[];
  scope: {
    scope_id: string;
    thread_id: string | null;
    session_id: string | null;
  };
  context: TaskContext;
  timeout_ms: number;
  max_tokens?: number;
}

/** Expected JSON structure from router CLI stdout */
interface RouterResponse {
  success: boolean;
  output: string;
  error?: string;
  tokens_used?: number;
  cost_usd?: number;
  model?: string;
  duration_ms?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STDOUT_LOG = 500;

export class SubprocessRouterAdapter implements RouterExecutionAdapter {
  private routerCommand: string;
  private routerConfigPath: string;
  private healthCache: Map<string, { result: HealthResult; timestamp: number }> = new Map();
  private healthCacheTtlMs: number;
  private lastError: string | null = null;

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

    const totalStart = Date.now();

    // Run all checks
    const binaryCheck = this.checkBinaryExists();
    const configCheck = this.checkConfigValid();
    const envCheck = this.checkEnvSufficient();
    const subprocessCheck = await this.checkSubprocessHealth();

    const checks = [binaryCheck, configCheck, envCheck, subprocessCheck];
    const allPassed = checks.every(c => c.passed);
    const failedChecks = checks.filter(c => !c.passed);

    const diagnostic: HealthResult = {
      healthy: allPassed,
      output: allPassed
        ? `All ${checks.length} checks passed`
        : `${failedChecks.length}/${checks.length} checks failed: ${failedChecks.map(c => `${c.name}: ${c.message}`).join("; ")}`,
      latencyMs: Date.now() - totalStart,
    };

    this.healthCache.set("default", { result: diagnostic, timestamp: Date.now() });
    return diagnostic;
  }

  getLastHealthError(): string | null {
    return this.lastError;
  }

  async execute(envelope: TaskEnvelope): Promise<ExecuteResult> {
    const timeoutMs = (envelope.metadata?.timeoutMs as number) ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    const payload = this.buildPayload(envelope, timeoutMs);

    return new Promise((resolve) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const done = (result: ExecuteResult) => {
        if (!settled) {
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(result);
        }
      };

      try {
        const args = ["--config", this.routerConfigPath, "route"];
        const child = spawn(this.routerCommand, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        // ── Timeout handling ──────────────────────────────────────────
        timeoutHandle = setTimeout(() => {
          child.kill("SIGKILL");
          done({
            success: false,
            output: `Router execution timed out after ${timeoutMs}ms`,
            exitCode: 1,
            durationMs: Date.now() - start,
          });
        }, timeoutMs);

        // ── Write payload to stdin ────────────────────────────────────
        child.stdin.on("error", () => {
          // EPIPE — child already exited, will be handled by error/close events
        });
        try {
          child.stdin.write(JSON.stringify(payload));
          child.stdin.end();
        } catch {
          // EPIPE — child already exited, will be handled below
        }

        // ── Collect output ────────────────────────────────────────────
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });

        // ── Error (spawn failure, ENOENT, etc.) ───────────────────────
        child.on("error", (err: NodeJS.ErrnoException) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          const msg =
            err.code === "ENOENT"
              ? `Router CLI not found: ${this.routerCommand}`
              : `Router spawn error: ${err.message}`;
          this.lastError = msg;
          done({
            success: false,
            output: msg,
            exitCode: 1,
            durationMs: Date.now() - start,
          });
        });

        // ── Close ─────────────────────────────────────────────────────
        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          done(this.normalizeResponse(code ?? 1, stdout, stderr, start));
        });
      } catch (err: any) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
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

  // ── Private helpers ────────────────────────────────────────────────────

  private checkBinaryExists(): HealthCheckResult {
    const start = Date.now();
    try {
      const binaryPath = this.routerCommand.split(" ")[0];
      const exists = fs.existsSync(binaryPath);
      return {
        name: "binary_exists",
        passed: exists,
        message: exists ? `Binary found: ${binaryPath}` : `Binary not found: ${binaryPath}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return { name: "binary_exists", passed: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  private checkConfigValid(): HealthCheckResult {
    const start = Date.now();
    if (!this.routerConfigPath) {
      return { name: "config_valid", passed: true, message: "No config path set (using defaults)", latencyMs: Date.now() - start };
    }
    try {
      const exists = fs.existsSync(this.routerConfigPath);
      return {
        name: "config_valid",
        passed: exists,
        message: exists ? `Config found: ${this.routerConfigPath}` : `Config not found: ${this.routerConfigPath}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return { name: "config_valid", passed: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  private checkEnvSufficient(): HealthCheckResult {
    const start = Date.now();
    const pathEnv = process.env.PATH || "";
    const binaryDir = this.routerCommand.split(" ")[0].split("/").slice(0, -1).join("/");
    const onPath = !binaryDir || binaryDir.startsWith("/") ? true : pathEnv.includes(binaryDir);
    return {
      name: "env_sufficient",
      passed: true,
      message: onPath ? "Environment OK" : `Binary dir '${binaryDir}' may not be in PATH`,
      latencyMs: Date.now() - start,
    };
  }

  private async checkSubprocessHealth(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const output = execSync(`${this.routerCommand} --health`, {
        timeout: 10000,
        encoding: "utf-8",
      }).trim();
      return {
        name: "subprocess_health",
        passed: true,
        message: output || "Health check OK",
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      this.lastError = err.message || String(err);
      return {
        name: "subprocess_health",
        passed: false,
        message: this.lastError,
        latencyMs: Date.now() - start,
      };
    }
  }

  /** Build the full RouterPayload from a TaskEnvelope */
  private buildPayload(envelope: TaskEnvelope, timeoutMs: number): RouterPayload {
    const taskMeta: TaskMeta = envelope.taskMeta ?? { type: "other" };
    const prompt = envelope.prompt ?? envelope.task;
    const attachments: Attachment[] = envelope.attachments ?? [];
    const context: TaskContext = envelope.context ?? {};

    return {
      task: envelope.task,
      task_id: envelope.taskId,
      task_meta: taskMeta,
      prompt,
      attachments,
      scope: {
        scope_id: envelope.scopeId,
        thread_id: envelope.threadId ?? null,
        session_id: envelope.sessionId ?? null,
      },
      context,
      timeout_ms: timeoutMs,
    };
  }

  /**
   * Normalize raw process output into an ExecuteResult.
   *
   * Try JSON parse first; fall back to raw text with error mapping.
   */
  private normalizeResponse(
    exitCode: number,
    stdout: string,
    stderr: string,
    start: number,
  ): ExecuteResult {
    const durationMs = Date.now() - start;

    // ── Attempt JSON parse ────────────────────────────────────────────
    const trimmed = stdout.trim();
    if (trimmed) {
      try {
        const parsed: RouterResponse = JSON.parse(trimmed);
        if (typeof parsed.success === "boolean") {
          return {
            success: parsed.success,
            output: parsed.output ?? parsed.error ?? "",
            exitCode: parsed.success ? 0 : exitCode ?? 1,
            durationMs: parsed.duration_ms ?? durationMs,
            costEstimateUsd: parsed.cost_usd,
            tokensUsed: parsed.tokens_used,
            model: parsed.model,
          };
        }
      } catch {
        // JSON parse failed — fall through to raw handling
      }
    }

    // ── Non-zero exit with no output ──────────────────────────────────
    if (exitCode !== 0 && !trimmed && !stderr.trim()) {
      return {
        success: false,
        output: `Router exited with code ${exitCode}, no output`,
        exitCode,
        durationMs,
      };
    }

    // ── Non-zero exit with stderr ─────────────────────────────────────
    if (exitCode !== 0) {
      return {
        success: false,
        output: stderr.trim() || trimmed || `Router exited with code ${exitCode}`,
        exitCode,
        durationMs,
      };
    }

    // ── Exit 0 but non-JSON output ────────────────────────────────────
    if (trimmed) {
      const truncated =
        trimmed.length > MAX_STDOUT_LOG
          ? trimmed.slice(0, MAX_STDOUT_LOG) + "…[truncated]"
          : trimmed;
      return {
        success: true,
        output: truncated,
        exitCode: 0,
        durationMs,
      };
    }

    // ── Exit 0, no stdout, maybe stderr ───────────────────────────────
    return {
      success: true,
      output: stderr.trim() || "",
      exitCode: 0,
      durationMs,
    };
  }
}
