import { handleRouterCommand } from "./src/commands";
import { matchRouterIntent, handleRouterIntent } from "./src/skill";
import { shouldDelegateToExecutionBackend, classifyTask } from "./src/policy";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";
import { createAdapter } from "./src/adapters/factory";
import { store } from "./src/commands";
import { ExecutionBackend, ScopeType } from "./src/types";
import { redactSecrets } from "./src/security";
import { recordSuccess, recordFallback, recordTimeout, recordHealthFailure } from "./src/metrics";
import { checkAutoDegrade } from "./src/safety";

export default function register(api: any) {
  const getConfig = (): PluginConfig => ({
    ...DEFAULT_CONFIG,
    ...(api.config?.plugins?.entries?.["router-bridge"]?.config ?? {}),
  });

  // ── Auto-reply command ────────────────────────────────────────────
  api.registerCommand({
    name: "router",
    description: "Control router execution backend (/router on|off|status)",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      return handleRouterCommand(ctx.args, ctx, getConfig());
    },
  });

  // ── Skill handler ─────────────────────────────────────────────────
  if (api.registerSkill) {
    api.registerSkill({
      id: "router-bridge",
      match: (input: string) => {
        const m = matchRouterIntent(input);
        return m.matched ? { action: m.action, confidence: m.confidence } : null;
      },
      handler: async (ctx: any) => {
        const config = getConfig();
        return handleRouterIntent(ctx.input || ctx.args || "", ctx, config);
      },
    });
  }

  // ── Execution hook: intercept coding tasks ────────────────────────
  if (api.on) {
    api.on("before_prompt_build", async (ctx: any) => {
      const config = getConfig();

      const taskText = ctx.userMessage || ctx.prompt || "";
      const classification = classifyTask(taskText);
      if (!classification.isCodingTask) return;

      const scopeType = config.scopeMode;
      const threadId = ctx.threadId || null;
      const sessionId = ctx.sessionKey || null;
      const scopeId = threadId || sessionId || "default";

      // Resolve effective backend from scoped store first, fall back to global
      const effective = store.getEffective(scopeType, scopeId, threadId || undefined, sessionId || undefined);
      const effectiveBackend = effective?.executionBackend || config.backendMode;

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
        const adapter = createAdapter(config, effectiveBackend);

        if (config.fallbackToNativeOnError) {
          const safety = checkAutoDegrade(config);
          if (safety.shouldDegrade) {
            ctx.routerFallback = true;
            ctx.routerError = `Auto-degraded: ${safety.reason}`;
            recordFallback(`auto-degraded: ${safety.reason}`);
            return;
          }
        }

        try {
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
          const result = await adapter.execute({
            task: taskText,
            taskId: ctx.messageId || `task-${Date.now()}`,
            scopeId,
            threadId,
            sessionId,
            taskMeta: { type: classification.taskType },
            taskClass: classification.taskClass,
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

  // ── Delegation service ────────────────────────────────────────────
  api.registerService({
    id: "router-bridge",
    start: () => {
      api.logger?.info("router-bridge service started");
    },
    stop: () => {
      api.logger?.info("router-bridge service stopped");
    },
  });
}
