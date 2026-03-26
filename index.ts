import { handleRouterCommand } from "./src/commands";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";

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
