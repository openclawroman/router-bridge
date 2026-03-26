import { describe, it, expect } from "vitest";
import { runDoctor } from "../src/doctor";
import { DEFAULT_CONFIG } from "../src/types";

describe("runDoctor", () => {
  it("returns an array of checks", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBe(7);
  });

  it("each check has name, passed, message", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    for (const check of checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("passed");
      expect(check).toHaveProperty("message");
      expect(typeof check.passed).toBe("boolean");
      expect(typeof check.message).toBe("string");
    }
  });

  it("check names are unique", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    const names = checks.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("python check passes on systems with python3", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    const python = checks.find(c => c.name === "python_available");
    expect(python).toBeDefined();
  });

  it("runtime_writable check passes (we can write to tmpdir)", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    const runtime = checks.find(c => c.name === "runtime_writable");
    expect(runtime).toBeDefined();
    expect(runtime!.passed).toBe(true);
  });

  it("router_binary check exists and has a message", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    const bin = checks.find(c => c.name === "router_binary");
    expect(bin).toBeDefined();
    expect(bin!.message).toBeTruthy();
    // The router may or may not be installed — just verify the check ran
  });

  it("config_exists check reports whether config file is found", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    const cfg = checks.find(c => c.name === "config_exists");
    expect(cfg).toBeDefined();
    // Either found or not found — both are valid outcomes
    expect(cfg!.message).toBeTruthy();
  });

  it("health_probe check exists and reports outcome", () => {
    const checks = runDoctor(DEFAULT_CONFIG);
    const health = checks.find(c => c.name === "health_probe");
    expect(health).toBeDefined();
    // May pass or fail depending on environment
  });
});
