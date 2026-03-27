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
import { markRecovered } from "./src/recovery";

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
    api.on("before_prompt_build", async (event: any, ctx: any) => {
      api.logger?.info?.(`[router-bridge] before_prompt_build fired: prompt=${JSON.stringify(event?.prompt ?? "").slice(0, 80)}`);

      const config = getConfig();

      const taskText = event.prompt || ctx.userMessage || "";
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
            recordFallback(`auto-degraded: ${safety.reason}`);
            return; // fallback to native — no prompt mutation
          }
        }

        try {
          const health = await adapter.health();
          if (!health.healthy) {
            if (config.fallbackToNativeOnError) {
              recordHealthFailure();
              recordFallback("health_failure");
              return;
            }
          }
        } catch (err: any) {
          if (config.fallbackToNativeOnError) {
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
            const parts = [];
            if (result.model) parts.push(result.model);
            if (result.costEstimateUsd && result.costEstimateUsd > 0) parts.push(`$${result.costEstimateUsd.toFixed(4)}`);
            if (result.durationMs) parts.push(`${result.durationMs}ms`);

            const footer = parts.length > 0 ? `\n\n🔧 via ${parts.join(" · ")}` : "";

            // Inject router output as prependContext — agent presents it to user
            const routerOutput = result.output + footer;
            return {
              prependContext: `[Router-bridge executed this coding task via ${result.model || "codex"}]\n\n${routerOutput}`,
            };
          } else if (config.fallbackToNativeOnError) {
            recordFallback(result.output || "execution_failed");
            return; // fallback to native
          }
        } catch (err: any) {
          if (config.fallbackToNativeOnError) {
            if (err.message?.includes("timed out")) {
              recordTimeout();
            }
            recordFallback(err.message || "exception");
            return; // fallback to native
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
