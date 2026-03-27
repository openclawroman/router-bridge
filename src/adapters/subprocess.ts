import { execFileSync, execSync, spawn } from "child_process";
import * as fs from "fs";
import type { RouterExecutionAdapter, HealthResult, HealthCheckResult, TaskEnvelope, ExecuteResult, TaskMeta, Attachment, TaskContext } from "./base";
import { redactSecrets } from "../security";

/** Payload sent to the router CLI via stdin */
interface RouterPayload {
  protocol_version: number;
  task: string;
  task_id: string;
  task_meta: TaskMeta & {
    task_id: string;
    task_class: string;
    risk: string;
    modality: string;
    requires_repo_write: boolean;
  };
  prompt: string;
  attachments: Attachment[];
  scope: {
    scope_id: string;
    thread_id: string | null;
    session_id: string | null;
  };
  context: TaskContext & {
    working_directory?: string;
    git_branch?: string;
    git_commit?: string;
    recent_files?: string[];
  };
  timeout_ms: number;
  max_tokens?: number;
}

/** Expected JSON structure from router CLI stdout */
interface RouterResponse {
  // From openclaw-router ExecutorResult
  protocol_version?: number;
  task_id?: string;
  tool?: string;
  backend?: string;
  model_profile?: string;
  success: boolean;
  normalized_error?: string | null;
  exit_code?: number;
  latency_ms?: number;
  request_id?: string | null;
  cost_estimate_usd?: number | null;
  artifacts?: string[];
  stdout_ref?: string | null;
  stderr_ref?: string | null;
  final_summary?: string;
  // Legacy fields (fallback compatibility)
  output?: string;
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
        const commandParts = this.routerCommand.trim().split(/\s+/);
        const executable = commandParts[0];
        const baseArgs = commandParts.slice(1);
        const args = ["--config", this.routerConfigPath, "route"];
        const env = {
          ...process.env,
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
        };
        const child = spawn(executable, [...baseArgs, ...args], {
          stdio: ["pipe", "pipe", "pipe"],
          env,
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
            output: redactSecrets(msg),
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
          output: redactSecrets(err.message || String(err)),
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

      // Absolute path — check filesystem directly
      if (binaryPath.startsWith("/")) {
        const exists = fs.existsSync(binaryPath);
        if (!exists) this.lastError = `Binary not found: ${binaryPath}`;
        return {
          name: "binary_exists",
          passed: exists,
          message: exists ? `Binary found: ${binaryPath}` : `Binary not found: ${binaryPath}`,
          latencyMs: Date.now() - start,
        };
      }

      // Relative name — check PATH via 'which'
      try {
        const resolved = execSync(`which ${binaryPath}`, { encoding: "utf-8" }).trim();
        if (!resolved) throw new Error("empty output");
        return {
          name: "binary_exists",
          passed: true,
          message: `Binary found in PATH: ${resolved}`,
          latencyMs: Date.now() - start,
        };
      } catch {
        this.lastError = `Binary '${binaryPath}' not found in PATH`;
        return {
          name: "binary_exists",
          passed: false,
          message: `Binary '${binaryPath}' not found in PATH`,
          latencyMs: Date.now() - start,
        };
      }
    } catch (err: any) {
      this.lastError = err.message;
      return { name: "binary_exists", passed: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  private checkConfigValid(): HealthCheckResult {
    const start = Date.now();
    if (!this.routerConfigPath || !this.routerConfigPath.trim()) {
      return { name: "config_valid", passed: true, message: "No config path set (using defaults)", latencyMs: Date.now() - start };
    }
    try {
      const exists = fs.existsSync(this.routerConfigPath);
      if (!exists) this.lastError = `Config not found: ${this.routerConfigPath}`;
      return {
        name: "config_valid",
        passed: exists,
        message: exists ? `Config found: ${this.routerConfigPath}` : `Config not found: ${this.routerConfigPath}`,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      this.lastError = err.message;
      return { name: "config_valid", passed: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  private checkEnvSufficient(): HealthCheckResult {
    const start = Date.now();
    const issues: string[] = [];

    // Check PATH is set
    if (!process.env.PATH) {
      issues.push("PATH not set");
    }

    // Check writable temp dir
    const tmpDir = process.env.TMPDIR || "/tmp";
    try {
      fs.accessSync(tmpDir, fs.constants.W_OK);
    } catch {
      issues.push(`Temp dir '${tmpDir}' not writable`);
    }

    const passed = issues.length === 0;
    return {
      name: "env_sufficient",
      passed,
      message: passed ? "Environment OK" : `Issues: ${issues.join("; ")}`,
      latencyMs: Date.now() - start,
    };
  }

  private async checkSubprocessHealth(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const commandParts = this.routerCommand.trim().split(/\s+/);
      const executable = commandParts[0];
      const baseArgs = commandParts.slice(1);
      const env = {
        ...process.env,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
      };
      const output = execFileSync(executable, ["--config", this.routerConfigPath, ...baseArgs, "--health"], {
        timeout: 10000,
        encoding: "utf-8",
        env,
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
    const taskMeta: TaskMeta = {
      type: envelope.taskMeta?.type ?? "other",
      priority: envelope.taskMeta?.priority,
      repoPath: envelope.taskMeta?.repoPath,
      branch: envelope.taskMeta?.branch,
      language: envelope.taskMeta?.language,
    };

    // Map task_type to router's expected schema
    const prompt = envelope.prompt ?? envelope.task;
    const attachments: Attachment[] = envelope.attachments ?? [];
    const context: TaskContext = envelope.context ?? {};

    const payload: RouterPayload = {
      protocol_version: 1,
      task: envelope.task,
      task_id: envelope.taskId,
      task_meta: {
        ...taskMeta,
        task_id: envelope.taskId, // router reads task_id from here
        task_class:
          envelope.taskClass ||
          (taskMeta.type === "coding"
            ? "implementation"
            : taskMeta.type === "review"
              ? "code_review"
              : taskMeta.type === "planning"
                ? "planner"
                : "implementation"),
        risk: "medium",
        modality: "text",
        requires_repo_write: taskMeta.type === "coding",
      },
      prompt,
      attachments,
      scope: {
        scope_id: envelope.scopeId,
        thread_id: envelope.threadId ?? null,
        session_id: envelope.sessionId ?? null,
      },
      context: {
        ...context,
        working_directory: context.workingDirectory,
        git_branch: context.gitBranch,
        git_commit: context.gitCommit,
        recent_files: context.recentFiles,
      },
      timeout_ms: timeoutMs,
    };

    // Continuity fields — add to payload if present
    if (envelope.cwd) (payload as any).cwd = envelope.cwd;
    if (envelope.recentContext) (payload as any).recent_context = envelope.recentContext;
    if (envelope.repoBranch) (payload as any).repo_branch = envelope.repoBranch;

    return payload;
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

        // Protocol version validation
        const pv = (parsed as any).protocol_version;
        if (pv !== undefined && pv !== 1) {
          return {
            success: false,
            output: `Protocol version mismatch: expected 1, got ${pv}`,
            exitCode: 1,
            durationMs: durationMs,
            costEstimateUsd: 0,
            tokensUsed: 0,
          };
        }

        if (typeof parsed.success === "boolean") {
          // Extract output — prefer final_summary (router format), fallback to output/error
          const outputText =
            parsed.final_summary
            ?? parsed.output
            ?? parsed.error
            ?? "";

          // Extract model — prefer model_profile, fallback to model
          const model = parsed.model_profile ?? parsed.model;

          // Extract cost — prefer cost_estimate_usd (router), fallback to cost_usd (legacy)
          const cost = parsed.cost_estimate_usd ?? parsed.cost_usd;

          // Extract duration — prefer latency_ms (router), fallback to duration_ms (legacy)
          const duration = parsed.latency_ms ?? parsed.duration_ms ?? durationMs;

          // Extract error details
          const errorDetails = parsed.success ? null : (parsed.normalized_error ?? parsed.error ?? "");

          return {
            success: parsed.success,
            output: parsed.success
              ? redactSecrets(outputText)
              : redactSecrets(errorDetails || outputText),
            exitCode: parsed.success ? 0 : (parsed.exit_code ?? exitCode ?? 1),
            durationMs: duration,
            costEstimateUsd: cost ?? 0,
            tokensUsed: parsed.tokens_used ?? 0,
            model,
            tool: parsed.tool,
            backend: parsed.backend,
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
        output: redactSecrets(stderr.trim() || trimmed || `Router exited with code ${exitCode}`),
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
        output: redactSecrets(truncated),
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
