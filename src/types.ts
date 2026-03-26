export enum ExecutionBackend {
  Native = "native",
  RouterBridge = "router-bridge",
  RouterAcp = "router-acp",
}

export enum ScopeType {
  Thread = "thread",
  Session = "session",
  Global = "global",
}

export interface RouterState {
  executionBackend: ExecutionBackend;
  scopeType: ScopeType;
  scopeId: string;
  threadId: string | null;
  sessionId: string | null;
  targetHarnessId: string | null;
}

export interface PluginConfig {
  backendMode: ExecutionBackend;
  scopeMode: ScopeType;
  routerCommand: string;
  routerConfigPath: string;
  fallbackToNativeOnError: boolean;
  healthCacheTtlMs: number;
  targetHarnessId: string;
  threadBindingMode: "per-thread" | "per-session" | "free";
  acpSessionKey: string | null;
}

export const DEFAULT_CONFIG: PluginConfig = {
  backendMode: ExecutionBackend.Native,
  scopeMode: ScopeType.Thread,
  routerCommand: "python3 /tmp/openclaw-router/cli.py",
  routerConfigPath: "/tmp/openclaw-router/config/router.yaml",
  fallbackToNativeOnError: true,
  healthCacheTtlMs: 30000,
  targetHarnessId: "default",
  threadBindingMode: "per-thread" as const,
  acpSessionKey: null,
};
