import { handleRouterCommand } from "./src/commands";
import { matchRouterIntent, handleRouterIntent } from "./src/skill";
import { shouldDelegateToExecutionBackend, classifyTask } from "./src/policy";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";

export default function register(api: any) {
  const getConfig = (): PluginConfig => ({
    ...DEFAULT_CONFIG,
    ...(api.config?.plugins?.entries?.["router-bridge"]?.config ?? {}),
  });

  // Auto-reply command
  api.registerCommand({
    name: "router",
    description: "Control router execution backend (/router on|off|status)",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      return handleRouterCommand(ctx.args, ctx, getConfig());
    },
  });

  // Skill handler — registered if api.registerSkill exists
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

  // Delegation service
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
