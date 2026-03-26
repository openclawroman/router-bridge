import { ensureRuntimeDirectories, validateStateIntegrity, repairStateFile } from "./store";
import { handleRouterCommand, handleRouterIntent, store } from "./commands";
import { matchRouterIntent } from "./skill";
import { classifyTask, shouldDelegateToExecutionBackend } from "./policy";
import { createAdapter } from "./adapters/factory";
import { checkAutoDegrade } from "./safety";
import { redactSecrets } from "./security";
import { recordSuccess, recordFallback, recordTimeout, recordHealthFailure } from "./metrics";
import { markRecovered } from "./recovery";
import type { PluginConfig } from "./types";
import { checkVersionCompatibility, formatVersionInfo } from "./src/versions";
import { validateConfig } from "./src/config-validate";

export { ensureRuntimeDirectories, validateStateIntegrity, repairStateFile } from "./store";
export { handleRouterCommand, handleRouterIntent, resolveScope, store } from "./commands";
export { matchRouterIntent } from "./skill";
export { createAdapter } from "./adapters/factory";
export type { TaskEnvelope, ExecuteResult, HealthResult } from "./adapters/base";
export { checkDisableOrReprobe, markRecovered, getRecoveryState, formatRecoveryState, resetRecoveryState } from "./recovery";

/**
 * Build a TaskEnvelope with continuity metadata from execution context.
 */
export function buildTaskEnvelope(opts: {
  task: string;
  taskId: string;
  scopeId: string;
  threadId?: string | null;
  sessionId?: string | null;
  taskMeta?: Record<string, any>;
  taskClass?: string;
  ctx?: any;
}) {
  const ctx = opts.ctx || {};
  return {
    task: opts.task,
    taskId: opts.taskId,
    scopeId: opts.scopeId,
    threadId: opts.threadId,
    sessionId: opts.sessionId,
    taskMeta: opts.taskMeta,
    taskClass: opts.taskClass,
    prompt: opts.task,
    cwd: ctx.cwd || process.cwd(),
    recentContext: ctx.recentMessages?.slice(-3)?.map((m: any) => m.text || m).join("\n") || null,
    repoBranch: ctx.gitBranch || null,
  };
}

/**
 * Register the router-bridge plugin.
 *
 * Call this from your OpenClaw extension entry point:
 *   import register from "router-bridge";
 *   register(api);
 */
export default function register(api: any) {
  // Ensure directories on startup
  ensureRuntimeDirectories();

  // Version compatibility check
  const versionInfo = checkVersionCompatibility();
  if (!versionInfo.compatible) {
    api.logger?.warn(`router-bridge: ${versionInfo.issues.join("; ")}`);
  }

  // Config validation
  const configValidation = validateConfig(api.config || {} as any);
  if (!configValidation.valid) {
    api.logger?.error(`router-bridge config errors: ${configValidation.errors.join("; ")}`);
  }
  for (const w of configValidation.warnings) {
    api.logger?.warn(`router-bridge config: ${w}`);
  }

  // Validate state integrity
  const { valid, issues } = validateStateIntegrity();
  if (!valid) {
    api.logger?.warn(`router-bridge: state integrity issues detected: ${issues.join(", ")}`);
    const repairResult = repairStateFile();
    api.logger?.info(`router-bridge: ${repairResult}`);
  }

  // Resolve config — prefer api.config, fall back to DEFAULT_CONFIG
  const config: PluginConfig = api.config || require("./types").DEFAULT_CONFIG;

  if (api.on) {
    api.on("before_prompt_build", async (ctx: any) => {

      // ── Resolve effective backend (check scoped store first) ──────
      const taskText = ctx.userMessage || ctx.prompt || "";
      const classification = classifyTask(taskText);
      if (!classification.isCodingTask) return;

      const scopeType = config.scopeMode;
      const threadId = ctx.threadId || null;
      const sessionId = ctx.sessionKey || null;
      const scopeId = threadId || sessionId || "default";

      // Look up scoped backend from store; fall back to global config
      const effectiveState = store.getEffective(scopeType, scopeId, threadId ?? undefined, sessionId ?? undefined);
      const effectiveBackend = effectiveState?.executionBackend || config.backendMode;

      // Early bail: if effective backend is "native", don't delegate
      if (effectiveBackend !== "router-bridge") return;

      const decision = await shouldDelegateToExecutionBackend(
        taskText,
        config,
        scopeId,
        scopeType,
        undefined,
        threadId,
        sessionId,
      );

      if (decision.delegate) {
        // Auto-degrade check
        if (config.fallbackToNativeOnError) {
          const safety = checkAutoDegrade(config);
          if (safety.shouldDegrade) {
            ctx.routerFallback = true;
            ctx.routerError = `Auto-degraded: ${safety.reason}`;
            recordFallback(`auto-degraded: ${safety.reason}`);
            return;
          }
        }

        // Pre-flight health check
        try {
          const adapter = createAdapter(config, effectiveBackend);
          const health = await adapter.health();
          if (!health.healthy) {
            if (config.fallbackToNativeOnError) {
              ctx.routerFallback = true;
              ctx.routerError = `Router unhealthy: ${redactSecrets(health.output)}`;
              recordHealthFailure();
              recordFallback("health_failure");
              return;
            }
          }
        } catch (err: any) {
          if (config.fallbackToNativeOnError) {
            ctx.routerFallback = true;
            ctx.routerError = `Health check failed: ${redactSecrets(err.message)}`;
            recordHealthFailure();
            recordFallback("health_exception");
            return;
          }
        }

        try {
          const adapter = createAdapter(config, effectiveBackend);
          const result = await adapter.execute({
            task: taskText,
            taskId: ctx.messageId || `task-${Date.now()}`,
            scopeId,
            threadId,
            sessionId,
            taskMeta: { type: classification.taskType },
            prompt: taskText,
            cwd: ctx.cwd || process.cwd(),
            recentContext: ctx.recentMessages?.slice(-3)?.map((m: any) => m.text || m).join("\n") || null,
            repoBranch: ctx.gitBranch || null,
          });

          if (result.success) {
            ctx.routerResult = result.output;
            ctx.routerMetadata = {
              backend: effectiveBackend,
              classification,
              durationMs: result.durationMs,
              costEstimateUsd: result.costEstimateUsd,
              tokensUsed: result.tokensUsed,
              model: result.model,
            };
            recordSuccess();
            markRecovered();
          } else if (config.fallbackToNativeOnError) {
            ctx.routerFallback = true;
            ctx.routerError = redactSecrets(result.output);
            recordFallback(result.output || "execution_failed");
          }
        } catch (err: any) {
          if (config.fallbackToNativeOnError) {
            ctx.routerFallback = true;
            ctx.routerError = redactSecrets(err.message);
            if (err.message?.includes("timed out")) {
              recordTimeout();
            }
            recordFallback(err.message || "exception");
          }
        }
      }
    });
  }

  return {
    handleRouterCommand,
    handleRouterIntent,
    matchRouterIntent,
    buildTaskEnvelope,
  };
}
