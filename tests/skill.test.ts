import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { matchRouterIntent, handleRouterIntent } from "../src/skill";
import { ensureDependencies } from "../src/dependencies";

// The store writes to this path at runtime — clean it between tests
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

describe("matchRouterIntent", () => {
  describe("enable patterns", () => {
    it.each([
      "switch to external routing",
      "use router here",
      "enable router",
      "turn on router",
      "route through router",
    ])("matches '%s'", (input) => {
      const result = matchRouterIntent(input);
      expect(result.matched).toBe(true);
      expect(result.action).toBe("on");
      expect(result.confidence).toBe(0.9);
    });
  });

  describe("disable patterns", () => {
    it.each([
      "turn off router",
      "disable router",
      "use native routing",
      "switch to native",
    ])("matches '%s'", (input) => {
      const result = matchRouterIntent(input);
      expect(result.matched).toBe(true);
      expect(result.action).toBe("off");
      expect(result.confidence).toBe(0.9);
    });
  });

  describe("status patterns", () => {
    it.each([
      "router status",
      "is router on",
      "what's my router config",
      "show router status",
      "what backend",
    ])("matches '%s'", (input) => {
      const result = matchRouterIntent(input);
      expect(result.matched).toBe(true);
      expect(result.action).toBe("status");
      expect(result.confidence).toBe(0.9);
    });
  });

  describe("non-matching inputs", () => {
    it("does not match 'hello world'", () => {
      const result = matchRouterIntent("hello world");
      expect(result.matched).toBe(false);
      expect(result.action).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("does not match 'write me a function'", () => {
      const result = matchRouterIntent("write me a function");
      expect(result.matched).toBe(false);
      expect(result.action).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("does not match broad 'use native' without routing/backend qualifier", () => {
      // Review fix: "use native language" should NOT match
      expect(matchRouterIntent("use native language").matched).toBe(false);
      expect(matchRouterIntent("use native modules").matched).toBe(false);
      expect(matchRouterIntent("use native resolution").matched).toBe(false);
    });
  });
});

describe("handleRouterIntent", () => {
  const ctx = { threadId: "t-skill-1", sessionKey: "s-skill-1" };
  const config = {
    backendMode: "router-bridge",
    scopeMode: "thread",
    routerCommand: "echo",
    routerConfigPath: "/tmp/test.yaml",
    fallbackToNativeOnError: true,
    healthCacheTtlMs: 30000,
  } as any;

  it("enable intent returns success message", async () => {
    const result = await handleRouterIntent("enable router", ctx, config);
    expect(result).not.toBeNull();
    if (ensureDependencies()) {
      expect(result!.text).toContain("Router backend enabled");
      expect(result!.text).toContain("router-bridge");
    } else {
      expect(result!.text).toContain("Missing dependencies");
    }
  });

  it("disable intent returns success message", async () => {
    const result = await handleRouterIntent("disable router", ctx, config);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Router backend disabled");
    expect(result!.text).toContain("native");
  });

  it("status intent returns status output", async () => {
    // Review fix: test the status path
    const result = await handleRouterIntent("router status", ctx, config);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Router Bridge Status");
  });

  it("non-matching input returns null", async () => {
    const result = await handleRouterIntent("hello world", ctx, config);
    expect(result).toBeNull();
  });

  it("uses same handler as /router on command", async () => {
    const onResult = await handleRouterIntent("turn on router", ctx, config);
    expect(onResult).not.toBeNull();
    if (ensureDependencies()) {
      expect(onResult!.text).toContain("Router backend enabled");
      expect(onResult!.text).toContain("Scope:");
      expect(onResult!.text).toContain("Backend:");
    } else {
      expect(onResult!.text).toContain("Missing dependencies");
    }
  });

  it("uses same handler as /router off command", async () => {
    const offResult = await handleRouterIntent("turn off router", ctx, config);
    expect(offResult).not.toBeNull();
    expect(offResult!.text).toContain("Router backend disabled");
    expect(offResult!.text).toContain("Scope:");
    expect(offResult!.text).toContain("Backend:");
  });
});
