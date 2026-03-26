import { handleRouterOn, handleRouterOff, handleRouterStatus } from "./src/commands";

interface RegisterCommandParams {
  name: string;
  description: string;
  acceptsArgs: boolean;
  requireAuth: boolean;
  handler: (ctx: { arg?: string }) => Promise<{ text: string }>;
}

interface PluginApi {
  registerCommand: (params: RegisterCommandParams) => void;
}

export default function register(api: PluginApi) {
  api.registerCommand({
    name: "router",
    description: "Control router execution backend",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const sub = (ctx.arg ?? "").trim().toLowerCase();

      switch (sub) {
        case "on":
          return handleRouterOn(ctx);
        case "off":
          return handleRouterOff(ctx);
        case "status":
          return handleRouterStatus(ctx);
        default:
          return {
            text: [
              "Usage: `/router <on|off|status>`",
              "• `on` — Enable router backend for this scope",
              "• `off` — Disable router backend (use native)",
              "• `status` — Show current router state",
            ].join("\n"),
          };
      }
    },
  });
}
