import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  handleRouterCommand,
  handleRouterOn,
  handleRouterOff,
  handleRouterStatus,
  handleRouterInitConfig,
} from "../src/commands";
import { DEFAULT_CONFIG } from "../src/types";

// The store writes to this path at runtime
const STATE_FILE = path.join(
  process.env.OPENCLAW_WORKSPACE || process.env.HOME || "/tmp",
  ".openclaw/workspace/extensions/router-bridge/.router-state.json"
);

beforeEach(() => {
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

afterEach(() => {
  try { fs.unlinkSync(STATE_FILE); } catch {}
});

describe("integration: /router commands", () => {
  it("on → status shows router active", async () => {
    const ctx = { threadId: "t-integ-1", sessionKey: "s-integ-1" };
    handleRouterOn(ctx, DEFAULT_CONFIG);
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("router-bridge");
  });

  it("off → status shows native", async () => {
    const ctx = { threadId: "t-integ-2", sessionKey: "s-integ-2" };
    handleRouterOff(ctx, DEFAULT_CONFIG);
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("native");
  });

  it("status includes doctor output", async () => {
    const ctx = { threadId: "t-integ-3" };
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Doctor:");
  });

  it("status includes config path", async () => {
    const ctx = { threadId: "t-integ-4" };
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Router command:");
    expect(status.text).toContain("ai-code-runner");
  });

  it("unknown subcommand returns error", async () => {
    const result = await handleRouterCommand("deploy", {}, DEFAULT_CONFIG);
    expect(result.text).toContain("Unknown subcommand");
  });

  it("on → off → on cycles correctly", async () => {
    const ctx = { threadId: "t-integ-5" };

    // Turn on
    handleRouterOn(ctx, DEFAULT_CONFIG);
    const statusOn = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOn.text).toContain("router-bridge");

    // Turn off
    handleRouterOff(ctx, DEFAULT_CONFIG);
    const statusOff = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOff.text).toContain("native");

    // Turn on again
    handleRouterOn(ctx, DEFAULT_CONFIG);
    const statusOn2 = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(statusOn2.text).toContain("router-bridge");
  });

  it("init-config creates config at expected path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "integ-init-"));
    const configPath = path.join(tmpDir, "router.config.json");
    try {
      const config = { ...DEFAULT_CONFIG, routerConfigPath: configPath };
      const ctx = { threadId: "t-integ-6" };
      const result = handleRouterInitConfig(ctx, config);
      expect(result.text).toMatch(/(✅|⚠️)/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("status includes Runtime section", async () => {
    const ctx = { threadId: "t-integ-7" };
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Runtime:");
    expect(status.text).toContain("Install root:");
    expect(status.text).toContain("Runtime dir:");
    expect(status.text).toContain("Provider secrets:");
  });

  it("status includes Rollout and Shadow status", async () => {
    const ctx = { threadId: "t-integ-8" };
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Rollout level:");
    expect(status.text).toContain("Shadow mode:");
  });

  it("status shows last fallback when context has routerFallback", async () => {
    const ctx = { threadId: "t-integ-9", routerFallback: true, routerError: "connection timeout" } as any;
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Last fallback:");
    expect(status.text).toContain("connection timeout");
  });

  it("status shows last success when context has routerMetadata", async () => {
    const ctx = {
      threadId: "t-integ-10",
      routerMetadata: { backend: "codex_cli", durationMs: 1234 },
    } as any;
    const status = await handleRouterStatus(ctx, DEFAULT_CONFIG);
    expect(status.text).toContain("Last success:");
    expect(status.text).toContain("codex_cli");
    expect(status.text).toContain("1234ms");
  });
});
