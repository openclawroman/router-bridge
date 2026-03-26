export interface HealthResult {
  healthy: boolean;
  output: string;
  latencyMs: number;
}

export interface TaskMeta {
  type: "coding" | "review" | "planning" | "chat" | "other";
  priority?: "low" | "medium" | "high" | "critical";
  repoPath?: string;
  branch?: string;
  language?: string;
  framework?: string;
}

export interface Attachment {
  name: string;
  content: string;
  mimeType?: string;
  encoding?: "utf8" | "base64";
}

export interface TaskContext {
  workingDirectory?: string;
  environmentVars?: Record<string, string>;
  recentFiles?: string[];
  gitBranch?: string;
  gitCommit?: string;
}

export interface TaskEnvelope {
  // Core
  task: string;
  taskId: string;
  scopeId: string;

  // Scope identity
  threadId?: string;
  sessionId?: string;

  // Rich payload
  taskMeta?: TaskMeta;
  prompt?: string;
  attachments?: Attachment[];
  context?: TaskContext;
  metadata?: Record<string, unknown>;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
  costEstimateUsd?: number;
  tokensUsed?: number;
  model?: string;
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
