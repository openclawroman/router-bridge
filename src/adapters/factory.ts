import type { PluginConfig } from "../types";
import { SubprocessRouterAdapter } from "./subprocess";
import { AcpRouterAdapter } from "./acp";
import type { RouterExecutionAdapter, HealthResult, TaskEnvelope, ExecuteResult } from "./base";

/** Native adapter — agent handles tasks directly, no external backend. */
class NativeAdapter implements RouterExecutionAdapter {
  async health(): Promise<HealthResult> {
    return { healthy: true, output: "native (agent handles tasks directly)", latencyMs: 0 };
  }
  async execute(_envelope: TaskEnvelope): Promise<ExecuteResult> {
    return { success: false, output: "Native mode: tasks are handled by the agent, not delegated.", exitCode: 0, durationMs: 0 };
  }
  supportsPersistentSession(): boolean { return false; }
  async closeScope(_scopeId: string): Promise<void> { /* no-op */ }
}

export function createAdapter(config: PluginConfig): RouterExecutionAdapter {
  switch (config.backendMode) {
    case "router-acp":
      return new AcpRouterAdapter({ targetHarnessId: config.targetHarnessId });
    case "router-bridge":
      return new SubprocessRouterAdapter({
        routerCommand: config.routerCommand,
        routerConfigPath: config.routerConfigPath,
        healthCacheTtlMs: config.healthCacheTtlMs,
      });
    case "native":
      return new NativeAdapter();
    default:
      throw new Error(`Unknown backendMode: ${config.backendMode}`);
  }
}
