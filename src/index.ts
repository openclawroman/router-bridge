import { ensureRuntimeDirectories, validateStateIntegrity, repairStateFile } from "./store";
import { handleRouterCommand, handleRouterIntent, store } from "./commands";
import { matchRouterIntent } from "./skill";
import { classifyTask, shouldDelegateToExecutionBackend } from "./policy";
import { createAdapter } from "./adapters/factory";
import { checkAutoDegrade } from "./safety";
import { redactSecrets } from "./security";
import { recordSuccess, recordFallback, recordTimeout, recordHealthFailure } from "./metrics";
import { markRecovered } from "./recovery";
import { extractRuntimeScope } from "./scope";
import type { PluginConfig } from "./types";
import { checkVersionCompatibility, formatVersionInfo } from "./src/versions";
import { validateConfig } from "./src/config-validate";

export { ensureRuntimeDirectories, validateStateIntegrity, repairStateFile } from "./store";
export { handleRouterCommand, handleRouterIntent, resolveScope, store } from "./commands";
export { matchRouterIntent } from "./skill";
export { extractRuntimeScope, formatScopeKey } from "./scope";
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
      if (config.traceRouting) {
        console.log(`[router-bridge] step=classify isCoding=${classification.isCodingTask} confidence=${classification.confidence}%`);
      }
      if (!classification.isCodingTask) return;

      const { scopeType, scopeId, threadId, sessionId } = extractRuntimeScope(ctx, config);

      // Look up scoped backend from store; fall back to global config
      const effectiveState = store.getEffective(scopeType, scopeId, threadId ?? undefined, sessionId ?? undefined);
      const effectiveBackend = effectiveState?.executionBackend || config.backendMode;

      if (config.traceRouting) {
        console.log(`[router-bridge] step=scope scopeType=${scopeType} scopeId=${scopeId}`);
      }

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

      if (config.traceRouting) {
        console.log(`[router-bridge] step=decision delegate=${decision.delegate} backend=${decision.backend}`);
      }

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

          if (config.traceRouting) {
            console.log(`[router-bridge] step=execute success=${result.success} latency=${result.durationMs ?? "N/A"}ms`);
          }

          if (result.success) {
            const TOOL_LABELS: Record<string, string> = {
              "codex_cli": "Codex CLI",
              "claude_code": "Claude Code",
              "openrouter_api": "OpenRouter API",
            };

            const BACKEND_LABELS: Record<string, string> = {
              "openai_native": "OpenAI",
              "anthropic": "Anthropic",
              "openrouter": "OpenRouter",
            };

            const MODEL_LABELS: Record<string, string> = {
              "codex_primary": "o3-mini",
              "codex_secondary": "o3",
              "openrouter_minimax": "MiniMax",
              "openrouter_kimi": "Kimi K2",
              "claude_primary": "Claude 4 Sonnet",
            };

            const toolLabel = TOOL_LABELS[result.tool!] || result.tool;
            const backendLabel = BACKEND_LABELS[result.backend!] || result.backend;
            const modelLabel = MODEL_LABELS[result.model!] || result.model;

            const parts = [toolLabel, backendLabel, modelLabel].filter(Boolean);
            const meta: string[] = [];
            if (result.durationMs) meta.push(`${(result.durationMs / 1000).toFixed(1)}s`);
            if (result.costEstimateUsd && result.costEstimateUsd > 0) meta.push(`$${result.costEstimateUsd.toFixed(4)}`);

            const footer = parts.length > 0
              ? `\n\n🔧 ${parts.join(" · ")}${meta.length ? " · " + meta.join(" · ") : ""}`
              : `\n\n🔧 router${meta.length ? " · " + meta.join(" · ") : ""}`;

            const prependContext = result.output + footer;

            if (config.traceRouting) {
              console.log(`[router-bridge] step=result prependContext len=${prependContext.length}`);
              console.log(`[router-bridge] step=result footer="${footer.trim()}"`);
              console.log(`[router-bridge] step=result last100="${prependContext.slice(-100)}"`);
            }

            recordSuccess();
            markRecovered();

            return { prependContext };
          } else if (config.fallbackToNativeOnError) {
            if (config.traceRouting) {
              console.log(`[router-bridge] step=fallback reason=${decision.reason}`);
            }
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
