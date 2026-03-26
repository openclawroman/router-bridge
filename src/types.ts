import * as path from "path";

export enum RolloutLevel {
  Native = "native",              // Level 0: fully native
  HealthCheck = "health-check",   // Level 1: router health checks only
  Thread = "thread",              // Level 2: thread-level opt-in
  Session = "session",            // Level 3: session-level opt-in
  Global = "global",              // Level 4: global default
}

export enum ShadowMode {
  Off = "off",
  Observe = "observe",            // Shadow runs but doesn't affect output
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
