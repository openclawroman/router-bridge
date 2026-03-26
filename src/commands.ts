import { ExecutionBackend, ScopeType, PluginConfig, DEFAULT_CONFIG } from "./types";
import { ExecutionBackendStore } from "./store";

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
  const state = store.set(scopeType, scopeId, ExecutionBackend.RouterBridge);
  state.threadId = threadId;
  state.sessionId = sessionId;
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

export function handleRouterStatus(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const { scopeType, scopeId, threadId, sessionId } = resolveScope(ctx, config);
  const effective = store.getEffective(scopeType, scopeId, threadId || undefined, sessionId || undefined);

  const lines = [
    "📊 **Router Bridge Status**",
    `Backend: \`${effective.executionBackend}\``,
    `Scope: ${effective.scopeType}:${effective.scopeId}`,
    `Thread: ${effective.threadId ?? "—"}`,
    `Session: ${effective.sessionId ?? "—"}`,
    "",
    "**Config:**",
    `Scope mode: ${config.scopeMode}`,
    `Router command: \`${config.routerCommand}\``,
    `Fallback on error: ${config.fallbackToNativeOnError ? "yes" : "no"}`,
    `Health cache TTL: ${config.healthCacheTtlMs}ms`,
  ];

  if (effective.executionBackend === ExecutionBackend.RouterAcp) {
    lines.push(`ACP target: ${effective.targetHarnessId ?? "—"}`);
  }

  return { text: lines.join("\n") };
}

export function handleRouterCommand(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
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
