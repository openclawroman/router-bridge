import { describe, it, expect } from "vitest";
import { Watchdog } from "../src/watchdog";

describe("watchdog", () => {
  it("starts with default limits", () => {
    const wd = new Watchdog();
    expect(wd.getHealthTimeout()).toBe(10000);
    expect(wd.getExecutionTimeout()).toBe(120000);
  });

  it("recordFailure increments count", () => {
    const wd = new Watchdog();
    wd.recordFailure();
    expect(wd.getFailureCount()).toBe(1);
  });

  it("recordSuccess resets count", () => {
    const wd = new Watchdog();
    wd.recordFailure();
    wd.recordFailure();
    wd.recordSuccess();
    expect(wd.getFailureCount()).toBe(0);
  });

  it("isCircuitOpen returns true after maxRetries", () => {
    const wd = new Watchdog({ maxRetries: 2 });
    expect(wd.isCircuitOpen()).toBe(false);
    wd.recordFailure();
    expect(wd.isCircuitOpen()).toBe(false);
    wd.recordFailure();
    expect(wd.isCircuitOpen()).toBe(true);
  });

  it("reset() clears failure count", () => {
    const wd = new Watchdog();
    wd.recordFailure();
    wd.recordFailure();
    wd.reset();
    expect(wd.getFailureCount()).toBe(0);
    expect(wd.isCircuitOpen()).toBe(false);
  });
});
