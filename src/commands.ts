import { ExecutionBackend, ScopeType, PluginConfig, DEFAULT_CONFIG } from "./types";
import { ExecutionBackendStore } from "./store";
import { createAdapter } from "./adapters/factory";
import type { HealthResult } from "./adapters/base";

const store = new ExecutionBackendStore();

function resolveScope(ctx: any, config: PluginConfig): { scopeType: ScopeType; scopeId: string; threadId: string | null; sessionId: string | null } {
  // Thread-scoped by default (matches OpenClaw convention)
  const scopeType = config.scopeMode === ScopeType.Global ? ScopeType.Global
    : config.scopeMode === ScopeType.Session ? ScopeType.Session
    : ScopeType.Thread;

  // Use channel context for scope ID when available
  const threadId = ctx.threadId || null;
  const sessionId = ctx.sessionKey || null;

  let scopeId: string;
  if (scopeType === ScopeType.Thread) {
    scopeId = threadId || sessionId || "default";
  } else if (scopeType === ScopeType.Session) {
    scopeId = sessionId || "default";
  } else {
    scopeId = "default";
  }

  return { scopeType, scopeId, threadId, sessionId };
}

export { resolveScope, store };

export function handleRouterOn(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const { scopeType, scopeId, threadId, sessionId } = resolveScope(ctx, config);
  store.set(scopeType, scopeId, ExecutionBackend.RouterBridge, threadId, sessionId);
  return {
    text: [
      "✅ Router backend enabled for this scope.",
      `Scope: ${scopeType}:${scopeId}`,
      `Backend: ${ExecutionBackend.RouterBridge}`,
    ].join("\n"),
  };
}

export function handleRouterOff(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const { scopeType, scopeId } = resolveScope(ctx, config);
  store.set(scopeType, scopeId, ExecutionBackend.Native);
  return {
    text: [
      "✅ Router backend disabled — using native.",
      `Scope: ${scopeType}:${scopeId}`,
      `Backend: ${ExecutionBackend.Native}`,
    ].join("\n"),
  };
}

export async function handleRouterStatus(ctx: any, config: PluginConfig = DEFAULT_CONFIG): Promise<{ text: string }> {
  const { scopeType, scopeId, threadId, sessionId } = resolveScope(ctx, config);
  const effective = store.getEffective(scopeType, scopeId, threadId || undefined, sessionId || undefined);

  // Health check — delegates through adapter (single source of truth)
  const adapter = createAdapter(config);
  const health = await adapter.health();
  const healthIcon = health.healthy ? "✅ healthy" : "❌ unavailable";
  const healthLine = `Health: ${healthIcon} (${health.latencyMs}ms)`;
  const healthOutput = `  Output: ${health.output}`;

  // Last error display
  const lastError = adapter.getLastHealthError?.() ?? null;
  const errorLine = lastError ? `\n⚠️ Last error: ${lastError}` : "";

  // Backend status
  const backendStatus = effective.executionBackend === ExecutionBackend.RouterBridge
    ? (health.healthy ? "active" : "unavailable")
    : "—";
  const backendLine = effective.executionBackend === ExecutionBackend.RouterBridge
    ? `Backend status: ${backendStatus}`
    : null;

  // Fallback policy
  const fallbackPolicy = config.fallbackToNativeOnError
    ? "native (auto-fallback on error)"
    : "none (errors will propagate)";

  const lines = [
    "📊 **Router Bridge Status**",
    `Backend: \`${effective.executionBackend}\``,
    `Scope: ${effective.scopeType}:${effective.scopeId}`,
    `Thread: ${effective.threadId ?? "—"}`,
    `Session: ${effective.sessionId ?? "—"}`,
    "",
    healthLine,
    healthOutput,
    errorLine,
    "",
    "**Config:**",
    `Scope mode: ${config.scopeMode}`,
    `Router command: \`${config.routerCommand}\``,
    `Fallback on error: ${config.fallbackToNativeOnError ? "yes" : "no"}`,
    `Health cache TTL: ${config.healthCacheTtlMs}ms`,
    "",
    `Fallback policy: ${fallbackPolicy}`,
  ];

  if (backendLine) lines.splice(6, 0, backendLine);

  if (effective.executionBackend === ExecutionBackend.RouterAcp) {
    lines.push(`ACP target: ${effective.targetHarnessId ?? "—"}`);
  }

  return { text: lines.join("\n") };
}

export async function handleRouterCommand(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): Promise<{ text: string }> {
  const sub = (args || "").trim().toLowerCase();
  switch (sub) {
    case "on":
      return handleRouterOn(ctx, config);
    case "off":
      return handleRouterOff(ctx, config);
    case "status":
    case "":
      return handleRouterStatus(ctx, config);
    default:
      return { text: `❌ Unknown subcommand: ${sub}\nUsage: /router [on|off|status]` };
  }
}
