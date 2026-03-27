import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { handleRouterOn, handleRouterOff, handleRouterStatus, handleRouterCommand, handleRouterDoctor } from "../src/commands";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import { ensureDependencies } from "../src/dependencies";

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

describe("handleRouterOn", () => {
  it("returns success or dependency warning based on system state", () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOn(ctx);

    if (ensureDependencies()) {
      // All deps installed — should enable router
      expect(result.text).toContain("Router backend enabled");
      expect(result.text).toContain("router-bridge");
      expect(result.text).toContain("thread:t123");
    } else {
      // Missing deps — should warn
      expect(result.text).toContain("Missing dependencies");
      expect(result.text).toContain("Install them before enabling router mode");
    }
  });

  it("includes dependency names in warning when deps are missing", () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOn(ctx);

    if (!ensureDependencies()) {
      // At least codex or claude should be flagged
      expect(result.text).toMatch(/❌.*(codex|claude)/);
    }
  });
});

describe("handleRouterOff", () => {
  it("returns success message with native backend", () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOff(ctx);
    expect(result.text).toContain("Router backend disabled");
    expect(result.text).toContain("native");
  });
});

describe("handleRouterStatus", () => {
  it("returns status message with config details", async () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = await handleRouterStatus(ctx);
    expect(result.text).toContain("Router Bridge Status");
    expect(result.text).toContain("Backend:");
    expect(result.text).toContain("Scope:");
    expect(result.text).toContain("Scope mode:");
    expect(result.text).toContain("Router command:");
    expect(result.text).toContain("Fallback on error:");
    expect(result.text).toContain("Health cache TTL:");
  });
});

describe("handleRouterCommand dispatch", () => {
  const ctx = { threadId: "t1", sessionKey: "s1" };

  it('"on" dispatches to handleRouterOn', async () => {
    const result = await handleRouterCommand("on", ctx);
    if (ensureDependencies()) {
      expect(result.text).toContain("Router backend enabled");
    } else {
      expect(result.text).toContain("Missing dependencies");
    }
  });

  it('"off" dispatches to handleRouterOff', async () => {
    const result = await handleRouterCommand("off", ctx);
    expect(result.text).toContain("Router backend disabled");
  });

  it('"status" dispatches to handleRouterStatus', async () => {
    const result = await handleRouterCommand("status", ctx);
    expect(result.text).toContain("Router Bridge Status");
  });

  it('"" (empty) defaults to status', async () => {
    const result = await handleRouterCommand("", ctx);
    expect(result.text).toContain("Router Bridge Status");
  });

  it("undefined args defaults to status", async () => {
    const result = await handleRouterCommand(undefined, ctx);
    expect(result.text).toContain("Router Bridge Status");
  });

  it('"bogus" returns error message', async () => {
    const result = await handleRouterCommand("bogus", ctx);
    expect(result.text).toContain("Unknown subcommand: bogus");
    expect(result.text).toContain("/router [on|off|status|rollout|shadow|snapshot|doctor|init-config|migrate-config]");
  });

  it('"doctor" dispatches to handleRouterDoctor', async () => {
    const result = await handleRouterCommand("doctor", ctx);
    expect(result.text).toContain("Router Doctor");
    expect(result.text).toContain("Dependency Check");
    expect(result.text).toContain("System Checks");
  });
});

describe("scope resolution", () => {
  // When deps are missing, handleRouterOn returns a warning before scope resolution.
  // These tests check the scope in the success case. When deps are missing, we verify
  // that the dependency gate fires correctly instead.

  it("uses threadId for thread scope mode (or warns about missing deps)", () => {
    const ctx = { threadId: "thread-1", sessionKey: "sess-1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    if (ensureDependencies()) {
      expect(result.text).toContain("thread:thread-1");
    } else {
      expect(result.text).toContain("Missing dependencies");
    }
  });

  it("falls back to sessionId when no threadId (or warns about missing deps)", () => {
    const ctx = { threadId: null, sessionKey: "sess-1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    if (ensureDependencies()) {
      expect(result.text).toContain("thread:sess-1");
    } else {
      expect(result.text).toContain("Missing dependencies");
    }
  });

  it("falls back to default when no context (or warns about missing deps)", () => {
    const ctx = { threadId: null, sessionKey: null };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    if (ensureDependencies()) {
      expect(result.text).toContain("thread:default");
    } else {
      expect(result.text).toContain("Missing dependencies");
    }
  });

  it("uses global scope when scopeMode is global (or warns about missing deps)", () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global } as typeof DEFAULT_CONFIG);
    if (ensureDependencies()) {
      expect(result.text).toContain("global:default");
    } else {
      expect(result.text).toContain("Missing dependencies");
    }
  });

  it("uses session scope when scopeMode is session (or warns about missing deps)", () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session } as typeof DEFAULT_CONFIG);
    if (ensureDependencies()) {
      expect(result.text).toContain("session:s1");
    } else {
      expect(result.text).toContain("Missing dependencies");
    }
  });
});

describe("health check integration", () => {
  it("handleRouterStatus includes health info via adapter", async () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = await handleRouterStatus(ctx);
    expect(result.text).toContain("Router Bridge Status");
    expect(result.text).toContain("Backend:");
    expect(result.text).toContain("Health:");
  });

  it("handleRouterStatus includes fallback policy", async () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = await handleRouterStatus(ctx);
    expect(result.text).toContain("Fallback");
  });

  it("handleRouterStatus shows config details", async () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = await handleRouterStatus(ctx);
    expect(result.text).toContain("Scope mode:");
    expect(result.text).toContain("Router command:");
    expect(result.text).toContain("Health cache TTL:");
  });

  it("handleRouterStatus with native backend shows healthy", async () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const config = { ...DEFAULT_CONFIG, backendMode: ExecutionBackend.Native };
    const result = await handleRouterStatus(ctx, config);
    expect(result.text).toContain("Health:");
    expect(result.text).toContain("healthy");
  });
});

describe("handleRouterDoctor", () => {
  const ctx = { threadId: "t1", sessionKey: "s1" };

  it("includes dependency check section", () => {
    const result = handleRouterDoctor(ctx);
    expect(result.text).toContain("🩺 **Router Doctor**");
    expect(result.text).toContain("Dependency Check");
  });

  it("includes all three dependency names", () => {
    const result = handleRouterDoctor(ctx);
    expect(result.text).toContain("codex");
    expect(result.text).toContain("claude");
    expect(result.text).toContain("python3");
  });

  it("includes system checks section", () => {
    const result = handleRouterDoctor(ctx);
    expect(result.text).toContain("System Checks");
  });

  it("includes pass/fail summary", () => {
    const result = handleRouterDoctor(ctx);
    // Should end with either "All checks passed" or "Issues found"
    expect(result.text).toMatch(/(All checks passed|Issues found)/);
  });
});
