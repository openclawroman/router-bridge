import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/config-validate";
import { DEFAULT_CONFIG, RolloutLevel } from "../src/types";

describe("validateConfig", () => {
  it("valid config passes validation", () => {
    const result = validateConfig(DEFAULT_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("missing scopeMode is an error", () => {
    const config = { ...DEFAULT_CONFIG, scopeMode: "" as any };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing scopeMode");
  });

  it("deprecated field produces warning", () => {
    const config = { ...DEFAULT_CONFIG, enableAutoFallback: true } as any;
    const result = validateConfig(config);
    expect(result.warnings.some(w => w.includes("enableAutoFallback"))).toBe(true);
  });

  it("healthCacheTtlMs < 1000 is an error", () => {
    const config = { ...DEFAULT_CONFIG, healthCacheTtlMs: 500 };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("healthCacheTtlMs"))).toBe(true);
  });

  it("invalid rolloutLevel is an error", () => {
    const config = { ...DEFAULT_CONFIG, rolloutLevel: "invalid" as any };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("rolloutLevel"))).toBe(true);
  });
});
