import { handleRouterCommand } from "./src/commands";
import { shouldDelegateToExecutionBackend, classifyTask } from "./src/policy";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";

/**
 * Router Bridge Plugin — registers the /router command and delegation service.
 *
 * This is an **auto-reply command**: it executes directly in the Gateway
 * with no model/AI involvement. The handler returns { text: string } which
 * is delivered to the user as-is, bypassing any LLM processing.
 */
export default function register(api: any) {
  // ── Merge plugin config with defaults ─────────────────────────────
  const getConfig = (): PluginConfig => ({
    ...DEFAULT_CONFIG,
    ...(api.config?.plugins?.entries?.["router-bridge"]?.config ?? {}),
  });

  // ── Auto-reply command: /router on|off|status ────────────────────
  api.registerCommand({
    name: "router",
    description: "Control router execution backend (/router on|off|status)",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      return handleRouterCommand(ctx.args, ctx, getConfig());
    },
  });

  // ── Delegation service ────────────────────────────────────────────
  // Other plugins or core can query this to check if a task should be delegated.
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
