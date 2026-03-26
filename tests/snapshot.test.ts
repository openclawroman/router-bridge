import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { takeSnapshot, restoreSnapshot, formatSnapshot } from "../src/snapshot";
import { DEFAULT_CONFIG } from "../src/types";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("takeSnapshot", () => {
  it("captures config", () => {
    const snap = takeSnapshot(DEFAULT_CONFIG);
    expect(snap.id).toMatch(/^snap-\d+$/);
    expect(snap.timestamp).toBeTruthy();
    expect(snap.config).toEqual(DEFAULT_CONFIG);
    expect(snap.stateContents).toBeNull();
    expect(snap.routerConfigContents).toBeNull();
  });

  it("captures state if present", () => {
    const routerRoot = path.join(tmpDir, "router");
    const stateDir = path.join(routerRoot, "runtime", "bridge");
    const statePath = path.join(stateDir, ".router-state.json");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ active: true }));

    const origRouterRoot = process.env.OPENCLAW_ROUTER_ROOT;
    process.env.OPENCLAW_ROUTER_ROOT = routerRoot;

    try {
      const snap = takeSnapshot(DEFAULT_CONFIG);
      expect(snap.stateContents).toBe('{"active":true}');
      expect(snap.statePath).toBe(statePath);
    } finally {
      if (origRouterRoot) process.env.OPENCLAW_ROUTER_ROOT = origRouterRoot;
      else delete process.env.OPENCLAW_ROUTER_ROOT;
    }
  });
});

describe("restoreSnapshot", () => {
  it("writes state file on restore", () => {
    const routerRoot = path.join(tmpDir, "router");
    const stateDir = path.join(routerRoot, "runtime", "bridge");
    const statePath = path.join(stateDir, ".router-state.json");

    const origRouterRoot = process.env.OPENCLAW_ROUTER_ROOT;
    process.env.OPENCLAW_ROUTER_ROOT = routerRoot;

    try {
      const snap = takeSnapshot(DEFAULT_CONFIG);
      // Manually set state contents to simulate a captured state
      const testSnap = { ...snap, stateContents: '{"restored":true}', statePath };
      const restored = restoreSnapshot(testSnap);
      expect(restored).toContain("state");
      expect(fs.readFileSync(statePath, "utf-8")).toBe('{"restored":true}');
    } finally {
      if (origRouterRoot) process.env.OPENCLAW_ROUTER_ROOT = origRouterRoot;
      else delete process.env.OPENCLAW_ROUTER_ROOT;
    }
  });

  it("writes config file on restore", () => {
    const configPath = path.join(tmpDir, "router.config.json");
    const config = { ...DEFAULT_CONFIG, routerConfigPath: configPath };

    const snap = takeSnapshot(config);
    const testSnap = { ...snap, routerConfigContents: '{"model":"test"}' };
    const restored = restoreSnapshot(testSnap);
    expect(restored).toContain("config");
    expect(fs.readFileSync(configPath, "utf-8")).toBe('{"model":"test"}');
  });
});

describe("formatSnapshot", () => {
  it("returns formatted string with captured status", () => {
    const snap = {
      id: "snap-123",
      timestamp: "2026-03-26T00:00:00.000Z",
      config: DEFAULT_CONFIG,
      statePath: "/fake/state.json",
      stateContents: '{"key":"val"}',
      routerConfigContents: null,
    };
    const formatted = formatSnapshot(snap);
    expect(formatted).toContain("snap-123");
    expect(formatted).toContain("2026-03-26T00:00:00.000Z");
    expect(formatted).toContain("State: captured");
    expect(formatted).toContain("Router config: none");
  });

  it("returns formatted string with no content", () => {
    const snap = {
      id: "snap-456",
      timestamp: "2026-03-26T00:00:00.000Z",
      config: DEFAULT_CONFIG,
      statePath: "/fake/state.json",
      stateContents: null,
      routerConfigContents: null,
    };
    const formatted = formatSnapshot(snap);
    expect(formatted).toContain("State: none");
    expect(formatted).toContain("Router config: none");
  });
});
