import { RolloutLevel, ShadowMode, type PluginConfig } from "./types";

export interface RolloutDecision {
  shouldRoute: boolean;
  shadowRun: boolean;
  reason: string;
}

/**
 * Decide whether to route based on rollout level and scope.
 */
export function shouldRoute(
  config: PluginConfig,
  scopeType: string,
  threadId: string | null,
  sessionId: string | null,
): RolloutDecision {
  const shadowRun = config.shadowMode === ShadowMode.Observe;

  switch (config.rolloutLevel) {
    case RolloutLevel.Native:
      return { shouldRoute: false, shadowRun, reason: "Rollout level: native only" };

    case RolloutLevel.HealthCheck:
      // Health checks run but no delegation
      return { shouldRoute: false, shadowRun, reason: "Rollout level: health-check only" };

    case RolloutLevel.Thread:
      // Only route if backend is set for this specific thread
      if (scopeType === "thread" && threadId) {
        return { shouldRoute: true, shadowRun: false, reason: "Thread-scoped routing enabled" };
      }
      return { shouldRoute: false, shadowRun, reason: "Not in thread scope" };

    case RolloutLevel.Session:
      if (scopeType === "session" && sessionId) {
        return { shouldRoute: true, shadowRun: false, reason: "Session-scoped routing enabled" };
      }
      return { shouldRoute: false, shadowRun, reason: "Not in session scope" };

    case RolloutLevel.Global:
      return { shouldRoute: true, shadowRun: false, reason: "Global routing enabled" };

    default:
      return { shouldRoute: false, shadowRun: false, reason: "Unknown rollout level" };
  }
}

/**
 * Format rollout level for display.
 */
export function describeRolloutLevel(level: RolloutLevel): string {
  switch (level) {
    case RolloutLevel.Native: return "0 — Native only (router inactive)";
    case RolloutLevel.HealthCheck: return "1 — Health checks only (shadow logging)";
    case RolloutLevel.Thread: return "2 — Thread-level opt-in";
    case RolloutLevel.Session: return "3 — Session-level opt-in";
    case RolloutLevel.Global: return "4 — Global default";
  }
}
