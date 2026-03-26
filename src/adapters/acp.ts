import type { RouterExecutionAdapter, HealthResult, TaskEnvelope, ExecuteResult } from "./base";

export class AcpRouterAdapter implements RouterExecutionAdapter {
  private targetHarnessId: string;

  constructor(opts: { 
    targetHarnessId: string;
    threadBindingMode?: string;
    acpSessionKey?: string | null;
  }) {
    this.targetHarnessId = opts.targetHarnessId;
  }

  async health(): Promise<HealthResult> {
    return {
      healthy: false,
      output: "ACP adapter not yet implemented (Phase 2)",
      latencyMs: 0,
    };
  }

  async execute(_envelope: TaskEnvelope): Promise<ExecuteResult> {
    return {
      success: false,
      output: "ACP adapter not yet implemented (Phase 2). Use router-bridge backend.",
      exitCode: 1,
      durationMs: 0,
    };
  }

  supportsPersistentSession(): boolean {
    return true; // ACP will support persistent sessions
  }

  async closeScope(_scopeId: string): Promise<void> {
    // Stub — will close ACP session in Phase 2
  }

  getLastHealthError(): string | null {
    return null; // Not an error — stub communicates via health().output
  }
}
