import { describe, it, expect } from "vitest";
import {
  checkDependency,
  checkAllDependencies,
  formatDependencyReport,
  ensureDependencies,
  getMissingDependencies,
  DependencyStatus,
} from "../src/dependencies";

describe("checkDependency", () => {
  it("returns installed=true for python3 (should be available)", () => {
    const result = checkDependency("python3");
    expect(result.name).toBe("python3");
    expect(result.installed).toBe(true);
    expect(result.path).toBeTruthy();
  });

  it("returns installed=false for a nonexistent binary", () => {
    const result = checkDependency("__nonexistent_binary_xyz_999__");
    expect(result.name).toBe("__nonexistent_binary_xyz_999__");
    expect(result.installed).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it("includes installHint for missing dependencies", () => {
    const result = checkDependency("codex");
    if (!result.installed) {
      expect(result.installHint).toBeTruthy();
      expect(result.installHint).toContain("codex");
    }
  });

  it("includes version when available", () => {
    const result = checkDependency("python3");
    if (result.installed) {
      // python3 --version typically returns something like "Python 3.11.x"
      expect(result.version).toBeTruthy();
    }
  });
});

describe("checkAllDependencies", () => {
  it("returns exactly 3 dependencies", () => {
    const deps = checkAllDependencies();
    expect(deps).toHaveLength(3);
  });

  it("includes codex, claude, python3", () => {
    const deps = checkAllDependencies();
    const names = deps.map(d => d.name);
    expect(names).toContain("codex");
    expect(names).toContain("claude");
    expect(names).toContain("python3");
  });

  it("each dep has required fields", () => {
    const deps = checkAllDependencies();
    for (const dep of deps) {
      expect(dep).toHaveProperty("name");
      expect(dep).toHaveProperty("installed");
      expect(typeof dep.name).toBe("string");
      expect(typeof dep.installed).toBe("boolean");
    }
  });
});

describe("formatDependencyReport", () => {
  it("formats installed dependencies with ✅", () => {
    const statuses: DependencyStatus[] = [
      { name: "python3", installed: true, version: "3.12.0", path: "/usr/bin/python3" },
    ];
    const report = formatDependencyReport(statuses);
    expect(report).toContain("✅");
    expect(report).toContain("python3");
    expect(report).toContain("v3.12.0");
    expect(report).toContain("/usr/bin/python3");
  });

  it("formats missing dependencies with ❌ and install hint", () => {
    const statuses: DependencyStatus[] = [
      { name: "codex", installed: false, installHint: "npm install -g @openai/codex" },
    ];
    const report = formatDependencyReport(statuses);
    expect(report).toContain("❌");
    expect(report).toContain("codex");
    expect(report).toContain("not found");
    expect(report).toContain("npm install -g @openai/codex");
  });

  it("handles mixed statuses", () => {
    const statuses: DependencyStatus[] = [
      { name: "python3", installed: true, version: "3.12.0" },
      { name: "codex", installed: false, installHint: "npm i -g codex" },
    ];
    const report = formatDependencyReport(statuses);
    expect(report).toContain("✅ python3");
    expect(report).toContain("❌ codex");
  });

  it("handles missing dep without installHint gracefully", () => {
    const statuses: DependencyStatus[] = [
      { name: "unknown", installed: false },
    ];
    const report = formatDependencyReport(statuses);
    expect(report).toContain("❌ unknown");
    expect(report).not.toContain("Install:");
  });
});

describe("ensureDependencies", () => {
  it("returns boolean", () => {
    const result = ensureDependencies();
    expect(typeof result).toBe("boolean");
  });

  // In CI/test environments, python3 is usually available but codex/claude likely not
  // so this will typically be false — that's expected
});

describe("getMissingDependencies", () => {
  it("returns an array", () => {
    const result = getMissingDependencies();
    expect(Array.isArray(result)).toBe(true);
  });

  it("only returns deps where installed is false", () => {
    const missing = getMissingDependencies();
    for (const dep of missing) {
      expect(dep.installed).toBe(false);
    }
  });

  it("python3 is usually not missing", () => {
    const missing = getMissingDependencies();
    const python = missing.find(d => d.name === "python3");
    // python3 should be available in test environments
    expect(python).toBeUndefined();
  });
});
