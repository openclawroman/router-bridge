import { describe, it, expect } from "vitest";
import { shouldRoute, describeRolloutLevel } from "../src/rollout";
import { RolloutLevel, ShadowMode, DEFAULT_CONFIG } from "../src/types";

describe("rollout", () => {
  it("native level never routes", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: RolloutLevel.Native };
    const decision = shouldRoute(config, "thread", "t-1", "s-1");
    expect(decision.shouldRoute).toBe(false);
    expect(decision.shadowRun).toBe(false);
  });
  it("health-check level never routes but can shadow", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: RolloutLevel.HealthCheck, shadowMode: ShadowMode.Observe };
    const decision = shouldRoute(config, "thread", "t-1", "s-1");
    expect(decision.shouldRoute).toBe(false);
    expect(decision.shadowRun).toBe(true);
  });
  it("thread level routes only in thread scope", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: RolloutLevel.Thread };
    const thread = shouldRoute(config, "thread", "t-1", "s-1");
    expect(thread.shouldRoute).toBe(true);
    const global = shouldRoute(config, "global", null, null);
    expect(global.shouldRoute).toBe(false);
  });
  it("session level routes only in session scope", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: RolloutLevel.Session };
    const session = shouldRoute(config, "session", null, "s-1");
    expect(session.shouldRoute).toBe(true);
    const thread = shouldRoute(config, "thread", "t-1", null);
    expect(thread.shouldRoute).toBe(false);
  });
  it("global level always routes", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: RolloutLevel.Global };
    const decision = shouldRoute(config, "global", null, null);
    expect(decision.shouldRoute).toBe(true);
  });
  it("shadow mode adds shadowRun flag", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: RolloutLevel.Native, shadowMode: ShadowMode.Observe };
    const decision = shouldRoute(config, "thread", "t-1", "s-1");
    expect(decision.shadowRun).toBe(true);
  });
  it("describeRolloutLevel returns human-readable description", () => {
    expect(describeRolloutLevel(RolloutLevel.Native)).toContain("Native");
    expect(describeRolloutLevel(RolloutLevel.Global)).toContain("Global");
  });
});
