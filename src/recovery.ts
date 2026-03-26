import { getMetrics } from "./metrics";

export interface RecoveryState {
  disabled: boolean;
  disabledAt: string | null;
  disableReason: string | null;
  lastReprobeAt: string | null;
  reprobeIntervalMs: number;
}

const DISABLE_THRESHOLD = 10; // consecutive failures before auto-disable
const REPROBE_INTERVAL_MS = 5 * 60 * 1000; // re-probe every 5 minutes

let recoveryState: RecoveryState = {
  disabled: false,
  disabledAt: null,
  disableReason: null,
  lastReprobeAt: null,
  reprobeIntervalMs: REPROBE_INTERVAL_MS,
};

/**
 * Check if router should be disabled due to repeated failures.
 * Auto-disable after DISABLE_THRESHOLD consecutive failures.
 * Periodically re-probe to see if router has recovered.
 */
export function checkDisableOrReprobe(metrics: ReturnType<typeof getMetrics>): RecoveryState {
  // Check if we should auto-disable
  const total = metrics.totalRouted + metrics.totalFallbacks;
  if (!recoveryState.disabled && total >= DISABLE_THRESHOLD && metrics.fallbackRate >= 90) {
    recoveryState.disabled = true;
    recoveryState.disabledAt = new Date().toISOString();
    recoveryState.disableReason = `Auto-disabled: fallback rate ${metrics.fallbackRate}% over ${total} requests`;
  }

  // Check if we should re-probe
  if (recoveryState.disabled && recoveryState.lastReprobeAt) {
    const elapsed = Date.now() - new Date(recoveryState.lastReprobeAt).getTime();
    if (elapsed >= recoveryState.reprobeIntervalMs) {
      // Time to re-probe — clear disabled state temporarily
      recoveryState.lastReprobeAt = new Date().toISOString();
    }
  } else if (recoveryState.disabled && !recoveryState.lastReprobeAt) {
    recoveryState.lastReprobeAt = new Date().toISOString();
  }

  return { ...recoveryState };
}

/**
 * Mark router as recovered after a successful probe.
 */
export function markRecovered(): void {
  recoveryState.disabled = false;
  recoveryState.disabledAt = null;
  recoveryState.disableReason = null;
  recoveryState.lastReprobeAt = null;
}

/**
 * Get current recovery state.
 */
export function getRecoveryState(): RecoveryState {
  return { ...recoveryState };
}

/**
 * Format recovery state for display.
 */
export function formatRecoveryState(): string {
  if (!recoveryState.disabled) return "✅ Active";
  const elapsed = recoveryState.disabledAt
    ? Math.round((Date.now() - new Date(recoveryState.disabledAt).getTime()) / 60000)
    : "?";
  return `🔴 Auto-disabled ${elapsed}m ago — ${recoveryState.disableReason}`;
}

/**
 * Reset recovery state (for testing).
 */
export function resetRecoveryState(): void {
  recoveryState = {
    disabled: false,
    disabledAt: null,
    disableReason: null,
    lastReprobeAt: null,
    reprobeIntervalMs: REPROBE_INTERVAL_MS,
  };
}
