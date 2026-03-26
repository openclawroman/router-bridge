import { getMetrics } from "./metrics";
import type { PluginConfig } from "./types";

export interface SafetyDecision {
  shouldDegrade: boolean;
  reason: string | null;
  fallbackRate: number;
  totalRequests: number;
}

const MIN_REQUESTS_FOR_DEGRADATION = 5;
const FALLBACK_RATE_THRESHOLD = 80; // percent

export function checkAutoDegrade(_config: PluginConfig): SafetyDecision {
  const metrics = getMetrics();
  const totalRequests = metrics.totalRouted + metrics.totalFallbacks;

  if (totalRequests < MIN_REQUESTS_FOR_DEGRADATION) {
    return {
      shouldDegrade: false,
      reason: null,
      fallbackRate: metrics.fallbackRate,
      totalRequests,
    };
  }

  if (metrics.fallbackRate >= FALLBACK_RATE_THRESHOLD) {
    return {
      shouldDegrade: true,
      reason: `Fallback rate ${metrics.fallbackRate}% exceeds threshold (${FALLBACK_RATE_THRESHOLD}%) over ${totalRequests} requests`,
      fallbackRate: metrics.fallbackRate,
      totalRequests,
    };
  }

  return {
    shouldDegrade: false,
    reason: null,
    fallbackRate: metrics.fallbackRate,
    totalRequests,
  };
}
