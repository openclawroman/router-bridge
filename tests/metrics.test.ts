import { describe, it, expect } from "vitest";
import { recordSuccess, recordFallback, recordTimeout, getMetrics, getMetricsSummary } from "../src/metrics";

describe("metrics", () => {
  it("recordSuccess increments counter", () => {
    const before = getMetrics().totalRouted;
    recordSuccess();
    const after = getMetrics().totalRouted;
    expect(after).toBe(before + 1);
  });

  it("recordFallback updates reason and timestamp", () => {
    recordFallback("test reason");
    const m = getMetrics();
    expect(m.lastFallbackReason).toBe("test reason");
    expect(m.lastFallbackAt).toBeTruthy();
  });

  it("recordTimeout increments counter", () => {
    const before = getMetrics().totalTimeouts;
    recordTimeout();
    expect(getMetrics().totalTimeouts).toBe(before + 1);
  });

  it("getMetrics returns a copy", () => {
    const a = getMetrics();
    const b = getMetrics();
    expect(a).not.toBe(b);
    expect(a.totalRouted).toBe(b.totalRouted);
  });

  it("getMetricsSummary includes counters", () => {
    const summary = getMetricsSummary();
    expect(summary).toContain("Routed:");
    expect(summary).toContain("Fallbacks:");
    expect(summary).toContain("Timeouts:");
  });
});
