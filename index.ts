import { handleRouterCommand } from "./src/commands";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";

/**
 * Router Bridge Plugin — registers the /router command.
 *
 * This is an **auto-reply command**: it executes directly in the Gateway
 * with no model/AI involvement. The handler returns { text: string } which
 * is delivered to the user as-is, bypassing any LLM processing.
 */
export default function register(api: any) {
  api.registerCommand({
    name: "router",
    description: "Control router execution backend (/router on|off|status)",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        ...(api.config?.plugins?.entries?.["router-bridge"]?.config ?? {}),
      };
      return handleRouterCommand(ctx.args, ctx, config);
    },
  });
}
