import * as path from "path";

export enum RolloutLevel {
  Native = "native",
  HealthCheck = "health-check",
  Thread = "thread",
  Session = "session",
  Global = "global",
}

export enum ShadowMode {
  Off = "off",
  Observe = "observe",
}

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
  rolloutLevel: RolloutLevel;
  shadowMode: ShadowMode;
  traceRouting?: boolean;
}

function defaultRouterRoot(): string {
  const home = process.env.HOME || "/root";
  return path.join(home, ".openclaw", "router");
}

function defaultRouterCommand(): string {
  return path.join(defaultRouterRoot(), "bin", "ai-code-runner");
}

function defaultRouterConfigPath(): string {
  return `${defaultRouterRoot()}/config/router.config.json`;
}

export const DEFAULT_CONFIG: PluginConfig = {
  backendMode: ExecutionBackend.Native,
  scopeMode: ScopeType.Thread,
  routerCommand: defaultRouterCommand(),
  routerConfigPath: defaultRouterConfigPath(),
  fallbackToNativeOnError: true,
  healthCacheTtlMs: 30000,
  targetHarnessId: "default",
  threadBindingMode: "per-thread" as const,
  acpSessionKey: null,
  rolloutLevel: RolloutLevel.Native,
  shadowMode: ShadowMode.Off,
};
