import { describe, it, expect, beforeEach } from "vitest";
import { handleRouterCommand, handleRouterOn, handleRouterOff, handleRouterStatus } from "../src/commands";
import { handleRouterIntent } from "../src/skill";
import { DEFAULT_CONFIG } from "../src/types";
import { resetRecoveryState } from "../src/recovery";

describe("smoke tests", () => {
  beforeEach(() => {
    resetRecoveryState();
  });

  it("full on → status → off cycle", async () => {
    const ctx = { threadId: "smoke-1", sessionKey: "smoke-1" };

    // Enable
    const on = handleRouterOn(ctx, DEFAULT_CONFIG);
    expect(on.text).toContain("router-bridge");

    // Check status while on
    const statusOn = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOn.text).toContain("Router Bridge Status");
    expect(statusOn.text).toContain("Metrics:");
    expect(statusOn.text).toContain("Recovery:");
    expect(statusOn.text).toContain("Version:");

    // Disable
    const off = handleRouterOff(ctx, DEFAULT_CONFIG);
    expect(off.text).toContain("native");

    // Check status while off
    const statusOff = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOff.text).toContain("native");
  });

  it("rollout levels are accessible", async () => {
    const ctx = { threadId: "smoke-2", sessionKey: "smoke-2" };
    const result = await handleRouterCommand("rollout", ctx, DEFAULT_CONFIG);
    expect(result.text).toContain("Rollout level:");
    expect(result.text).toContain("native");
    expect(result.text).toContain("health-check");
    expect(result.text).toContain("thread");
    expect(result.text).toContain("session");
    expect(result.text).toContain("global");
  });

  it("shadow modes are accessible", async () => {
    const ctx = { threadId: "smoke-3", sessionKey: "smoke-3" };
    const result = await handleRouterCommand("shadow", ctx, DEFAULT_CONFIG);
    expect(result.text).toContain("Shadow mode:");
    expect(result.text).toContain("off");
    expect(result.text).toContain("observe");
  });

  it("snapshot works", async () => {
    const ctx = { threadId: "smoke-4", sessionKey: "smoke-4" };
    const result = await handleRouterCommand("snapshot", ctx, DEFAULT_CONFIG);
    expect(result.text).toContain("Snapshot");
  });

  it("skill handler matches commands", async () => {
    const config = DEFAULT_CONFIG;
    const ctx = { threadId: "smoke-5", sessionKey: "smoke-5" };

    const status = await handleRouterIntent("router status", ctx, config);
    expect(status).not.toBeNull();
    expect(status!.text).toContain("Status");
  });

  it("unknown subcommand shows usage", async () => {
    const result = await handleRouterCommand("badcommand", {}, DEFAULT_CONFIG);
    expect(result.text).toContain("Unknown");
    expect(result.text).toContain("/router");
  });
});
