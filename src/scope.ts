import { ScopeType } from "./types";
import type { PluginConfig } from "./types";

/**
 * Extract runtime scope information from hook context and plugin config.
 *
 * This is the single source of truth for scope resolution across the router-bridge plugin.
 * Used by both the execution hook (index.ts) and command handlers (commands.ts).
 */
export function extractRuntimeScope(
  ctx: any,
  config: PluginConfig,
): {
  scopeType: ScopeType;
  scopeId: string;
  threadId: string | null;
  sessionId: string | null;
} {
  // Thread-scoped by default (matches OpenClaw convention)
  const scopeType =
    config.scopeMode === ScopeType.Global
      ? ScopeType.Global
      : config.scopeMode === ScopeType.Session
        ? ScopeType.Session
        : ScopeType.Thread;

  // Use hookCtx fields: sessionKey (thread identifier), sessionId
  const threadId = ctx.sessionKey || ctx.threadId || null;
  const sessionId = ctx.sessionId || null;

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

/** Format a scope key like "thread:agent:main:main" for logging */
export function formatScopeKey(scopeType: ScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}
