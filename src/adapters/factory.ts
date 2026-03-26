import type { PluginConfig } from "../types";
import { SubprocessRouterAdapter } from "./subprocess";
import { AcpRouterAdapter } from "./acp";
import type { RouterExecutionAdapter } from "./base";

export function createAdapter(config: PluginConfig): RouterExecutionAdapter {
  if (config.backendMode === "router-acp") {
    // Phase 2: ACP adapter (stub for now)
    return new AcpRouterAdapter({ targetHarnessId: "default" });
  }
  // Default: subprocess adapter
  return new SubprocessRouterAdapter({
    routerCommand: config.routerCommand,
    routerConfigPath: config.routerConfigPath,
    healthCacheTtlMs: config.healthCacheTtlMs,
  });
}
