import { describe, it, expect, beforeEach } from "vitest";
import { checkDisableOrReprobe, markRecovered, getRecoveryState, resetRecoveryState, formatRecoveryState } from "../src/recovery";

describe("recovery", () => {
  beforeEach(() => {
    resetRecoveryState();
  });

  it("starts as active", () => {
    expect(getRecoveryState().disabled).toBe(false);
    expect(formatRecoveryState()).toContain("Active");
  });

  it("auto-disables after high fallback rate", () => {
    const fakeMetrics = {
      totalRouted: 1,
      totalFallbacks: 9,
      fallbackRate: 90,
      totalTimeouts: 0,
      totalHealthFailures: 0,
      totalMalformedResponses: 0,
      totalAuthFailures: 0,
      totalShadowRuns: 0,
      totalShadowDisagreements: 0,
      lastSuccessAt: null,
      lastFallbackAt: new Date().toISOString(),
      lastFallbackReason: "test",
      lastHealthFailureAt: null,
      sessionStartedAt: new Date().toISOString(),
    };
    const result = checkDisableOrReprobe(fakeMetrics);
    expect(result.disabled).toBe(true);
    expect(result.disableReason).toContain("90%");
  });

  it("markRecovered clears disabled state", () => {
    const fakeMetrics = {
      totalRouted: 1, totalFallbacks: 9, fallbackRate: 90,
      totalTimeouts: 0, totalHealthFailures: 0, totalMalformedResponses: 0,
      totalAuthFailures: 0, totalShadowRuns: 0, totalShadowDisagreements: 0,
      lastSuccessAt: null, lastFallbackAt: new Date().toISOString(),
      lastFallbackReason: "test", lastHealthFailureAt: null,
      sessionStartedAt: new Date().toISOString(),
    };
    checkDisableOrReprobe(fakeMetrics);
    expect(getRecoveryState().disabled).toBe(true);

    markRecovered();
    expect(getRecoveryState().disabled).toBe(false);
  });

  it("does not disable with low fallback rate", () => {
    const fakeMetrics = {
      totalRouted: 10, totalFallbacks: 2, fallbackRate: 16.67,
      totalTimeouts: 0, totalHealthFailures: 0, totalMalformedResponses: 0,
      totalAuthFailures: 0, totalShadowRuns: 0, totalShadowDisagreements: 0,
      lastSuccessAt: new Date().toISOString(), lastFallbackAt: new Date().toISOString(),
      lastFallbackReason: "test", lastHealthFailureAt: null,
      sessionStartedAt: new Date().toISOString(),
    };
    const result = checkDisableOrReprobe(fakeMetrics);
    expect(result.disabled).toBe(false);
  });

  it("does not disable below threshold", () => {
    // Only 5 total requests - below DISABLE_THRESHOLD of 10
    const fakeMetrics = {
      totalRouted: 0, totalFallbacks: 5, fallbackRate: 100,
      totalTimeouts: 0, totalHealthFailures: 0, totalMalformedResponses: 0,
      totalAuthFailures: 0, totalShadowRuns: 0, totalShadowDisagreements: 0,
      lastSuccessAt: null, lastFallbackAt: new Date().toISOString(),
      lastFallbackReason: "test", lastHealthFailureAt: null,
      sessionStartedAt: new Date().toISOString(),
    };
    const result = checkDisableOrReprobe(fakeMetrics);
    expect(result.disabled).toBe(false);
  });

  it("formatRecoveryState shows details when disabled", () => {
    const fakeMetrics = {
      totalRouted: 1, totalFallbacks: 9, fallbackRate: 90,
      totalTimeouts: 0, totalHealthFailures: 0, totalMalformedResponses: 0,
      totalAuthFailures: 0, totalShadowRuns: 0, totalShadowDisagreements: 0,
      lastSuccessAt: null, lastFallbackAt: new Date().toISOString(),
      lastFallbackReason: "test", lastHealthFailureAt: null,
      sessionStartedAt: new Date().toISOString(),
    };
    checkDisableOrReprobe(fakeMetrics);
    const formatted = formatRecoveryState();
    expect(formatted).toContain("Auto-disabled");
    expect(formatted).toContain("ago");
  });
});
