import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { handleRouterCommand, handleRouterOn, handleRouterOff, handleRouterStatus } from "../src/commands";
import { DEFAULT_CONFIG, RolloutLevel, ShadowMode } from "../src/types";

const ISOLATED_ROUTER_ROOT = path.join(os.tmpdir(), `router-bridge-p3-test-${process.pid}-${Date.now()}`, ".openclaw", "router");
const STATE_FILE = path.join(ISOLATED_ROUTER_ROOT, "runtime", "bridge", "state.json");

beforeEach(() => {
  process.env.OPENCLAW_ROUTER_ROOT = ISOLATED_ROUTER_ROOT;
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

afterEach(() => {
  delete process.env.OPENCLAW_ROUTER_ROOT;
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

describe("Phase 3 integration", () => {
  it("status includes all sections", async () => {
    const ctx = { threadId: "t-p3-1", sessionKey: "s-p3-1" };
    const status = await handleRouterStatus(ctx, {
      ...DEFAULT_CONFIG,
      rolloutLevel: RolloutLevel.Thread,
      shadowMode: ShadowMode.Observe,
    });
    // Header
    expect(status.text).toContain("Router Bridge Status");
    // Backend
    expect(status.text).toContain("Backend:");
    expect(status.text).toContain("Scope:");
    // Health
    expect(status.text).toContain("Health:");
    // Config
    expect(status.text).toContain("Config:");
    expect(status.text).toContain("Scope mode:");
    expect(status.text).toContain("Router command:");
    expect(status.text).toContain("Health cache TTL:");
    // Runtime
    expect(status.text).toContain("Runtime:");
    expect(status.text).toContain("Install root:");
    expect(status.text).toContain("Runtime dir:");
    // Rollout / Shadow (either format depending on module availability)
    expect(status.text).toMatch(/Rollout|Shadow/);
    expect(status.text).toContain("observe");
    // Doctor
    expect(status.text).toContain("Doctor:");
  });

  it("on → status → off cycle works with new modules", async () => {
    const ctx = { threadId: "t-p3-2", sessionKey: "s-p3-2" };
    handleRouterOn(ctx, DEFAULT_CONFIG);
    const statusOn = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOn.text).toContain("router-bridge");

    handleRouterOff(ctx, DEFAULT_CONFIG);
    const statusOff = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOff.text).toContain("native");
  });

  it("rollout command displays levels", async () => {
    const result = await handleRouterCommand("rollout", {}, DEFAULT_CONFIG);
    expect(result.text).toContain("Rollout level:");
    expect(result.text).toContain("native");
    expect(result.text).toContain("global");
  });

  it("shadow command displays modes", async () => {
    const result = await handleRouterCommand("shadow", {}, DEFAULT_CONFIG);
    expect(result.text).toContain("Shadow mode:");
    expect(result.text).toContain("off");
    expect(result.text).toContain("observe");
  });

  it("snapshot command works", async () => {
    const result = await handleRouterCommand("snapshot", {}, DEFAULT_CONFIG);
    expect(result.text).toContain("Snapshot");
  });

  it("status shows rollout level in configured state", async () => {
    const ctx = { threadId: "t-p3-6", sessionKey: "s-p3-6" };
    const status = await handleRouterStatus(ctx, {
      ...DEFAULT_CONFIG,
      rolloutLevel: RolloutLevel.Session,
      shadowMode: ShadowMode.Observe,
    });
    expect(status.text).toContain("3 — Session-level opt-in");
    expect(status.text).toContain("observe");
  });

  it("status shows fallback policy", async () => {
    const ctx = { threadId: "t-p3-7", sessionKey: "s-p3-7" };
    const status = await handleRouterStatus(ctx, {
      ...DEFAULT_CONFIG,
      fallbackToNativeOnError: true,
    });
    expect(status.text).toContain("native (auto-fallback on error)");
  });

  it("status includes doctor checks with security audit", async () => {
    const ctx = { threadId: "t-p3-8", sessionKey: "s-p3-8" };
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Doctor:");
    expect(status.text).toContain("security_audit");
    expect(status.text).toContain("python_available");
    expect(status.text).toContain("router_binary");
    expect(status.text).toContain("config_exists");
    expect(status.text).toContain("runtime_writable");
    expect(status.text).toContain("secrets_present");
    expect(status.text).toContain("health_probe");
  });
});
