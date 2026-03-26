import { handleRouterCommand } from "./src/commands";
import { matchRouterIntent, handleRouterIntent } from "./src/skill";
import { shouldDelegateToExecutionBackend, classifyTask } from "./src/policy";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";
import { createAdapter } from "./src/adapters/factory";
import { store } from "./src/commands";
import { ExecutionBackend, ScopeType } from "./src/types";

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
      if (config.backendMode !== "router-bridge") return;

      const taskText = ctx.userMessage || ctx.prompt || "";
      const classification = classifyTask(taskText);
      if (!classification.isCodingTask) return;

      const scopeType = config.scopeMode;
      const threadId = ctx.threadId || null;
      const sessionId = ctx.sessionKey || null;
      const scopeId = threadId || sessionId || "default";

      const decision = await shouldDelegateToExecutionBackend(
        taskText,
        config,
        scopeId,
        scopeType,
      );

      if (decision.delegate) {
        const adapter = createAdapter(config);
        try {
          const result = await adapter.execute({
            task: taskText,
            taskId: ctx.messageId || `task-${Date.now()}`,
            scopeId,
            threadId,
            sessionId,
            taskMeta: { type: classification.taskType },
            prompt: taskText,
          });

          if (result.success) {
            // Inject result into context so the model sees it
            ctx.routerResult = result.output;
            ctx.routerMetadata = {
              backend: "router-bridge",
              classification,
              durationMs: result.durationMs,
              costEstimateUsd: result.costEstimateUsd,
              tokensUsed: result.tokensUsed,
              model: result.model,
            };
          } else if (config.fallbackToNativeOnError) {
            // Fall back to native — let the model handle it
            ctx.routerFallback = true;
            ctx.routerError = result.output;
          }
        } catch (err: any) {
          if (config.fallbackToNativeOnError) {
            ctx.routerFallback = true;
            ctx.routerError = err.message;
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
