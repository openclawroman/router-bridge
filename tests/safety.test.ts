import { describe, it, expect } from "vitest";
import { checkAutoDegrade } from "../src/safety";
import { recordSuccess, recordFallback } from "../src/metrics";
import { DEFAULT_CONFIG } from "../src/types";

describe("safety", () => {
  it("returns false with too few requests", () => {
    const decision = checkAutoDegrade(DEFAULT_CONFIG);
    expect(decision.shouldDegrade).toBe(false);
    expect(decision.reason).toBeNull();
  });

  it("includes reason when degraded", () => {
    // Record enough failures to trigger degradation
    for (let i = 0; i < 8; i++) recordFallback("test error");
    for (let i = 0; i < 2; i++) recordSuccess();
    // Fallback rate = 8/10 = 80% → should degrade
    const decision = checkAutoDegrade(DEFAULT_CONFIG);
    expect(decision.shouldDegrade).toBe(true);
    expect(decision.reason).toContain("Fallback rate");
  });

  it("returns fallbackRate and totalRequests", () => {
    const decision = checkAutoDegrade(DEFAULT_CONFIG);
    expect(typeof decision.fallbackRate).toBe("number");
    expect(typeof decision.totalRequests).toBe("number");
  });
});
