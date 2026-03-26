export interface HealthResult {
  healthy: boolean;
  output: string;
  latencyMs: number;
}

export interface TaskEnvelope {
  task: string;
  taskId: string;
  scopeId: string;
  threadId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
  costEstimateUsd?: number;
}

export interface RouterExecutionAdapter {
  /** Check if the backend is reachable and healthy */
  health(): Promise<HealthResult>;

  /** Execute a coding task through this adapter */
  execute(envelope: TaskEnvelope): Promise<ExecuteResult>;

  /** Whether this adapter supports persistent sessions (ACP) or is one-shot (subprocess) */
  supportsPersistentSession(): boolean;

  /** Clean up resources for a scope. No-op for subprocess, session.close() for ACP */
  closeScope(scopeId: string): Promise<void>;
}
