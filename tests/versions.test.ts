import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  getPluginVersion,
  checkVersionCompatibility,
  formatVersionInfo,
  REQUIRED_ROUTER_VERSION,
} from "../src/versions";

describe("getPluginVersion", () => {
  it("returns a version string", () => {
    const version = getPluginVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});

describe("checkVersionCompatibility", () => {
  it("returns object with compatible field", () => {
    const info = checkVersionCompatibility();
    expect(info).toHaveProperty("compatible");
    expect(typeof info.compatible).toBe("boolean");
  });

  it("has required fields", () => {
    const info = checkVersionCompatibility();
    expect(info).toHaveProperty("pluginVersion");
    expect(info).toHaveProperty("requiredRouterVersion");
    expect(info).toHaveProperty("installedRouterVersion");
    expect(info).toHaveProperty("issues");
    expect(Array.isArray(info.issues)).toBe(true);
    expect(info.requiredRouterVersion).toBe(REQUIRED_ROUTER_VERSION);
  });
});

describe("version sanity", () => {
  it("plugin version matches package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
    );
    expect(getPluginVersion()).toBe(pkg.version);
  });

  it("plugin version is not fallback 0.0.0", () => {
    expect(getPluginVersion()).not.toBe("0.0.0");
  });
});

describe("formatVersionInfo", () => {
  it("includes Plugin and Router labels", () => {
    const info = checkVersionCompatibility();
    const formatted = formatVersionInfo(info);
    expect(formatted).toContain("Plugin:");
    expect(formatted).toContain("Router:");
    expect(formatted).toContain("Required:");
  });
});
