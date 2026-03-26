import * as path from "path";
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
  getLastHealthError(): string | null { return null; }
}

export function createAdapter(config: PluginConfig, backendOverride?: string): RouterExecutionAdapter {
  const backend = backendOverride || config.backendMode;

  if (backend === "router-acp") {
    return new AcpRouterAdapter({ targetHarnessId: config.targetHarnessId });
  }

  if (backend === "router-bridge") {
    // Use the configured router command, or fall back to canonical path
    const routerCommand = config.routerCommand || path.join(
      process.env.OPENCLAW_ROUTER_ROOT || path.join(process.env.HOME || "/root", ".openclaw", "router"),
      "bin", "ai-code-runner"
    );
    const routerConfigPath = config.routerConfigPath || path.join(
      process.env.OPENCLAW_ROUTER_ROOT || path.join(process.env.HOME || "/root", ".openclaw", "router"),
      "config", "router.config.json"
    );
    return new SubprocessRouterAdapter({
      routerCommand,
      routerConfigPath,
      healthCacheTtlMs: config.healthCacheTtlMs,
    });
  }

  if (backend === "native") {
    return new NativeAdapter();
  }

  throw new Error(`Unknown backend mode: ${backend}`);
}
