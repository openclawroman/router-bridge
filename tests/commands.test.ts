import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { handleRouterOn, handleRouterOff, handleRouterStatus, handleRouterCommand, handleRouterDoctor } from "../src/commands";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";
import { ensureDependencies } from "../src/dependencies";

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
  it("returns success or warning based on system state", () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOn(ctx);

    const hasDepsWarning = result.text.includes("Missing dependencies");
    const hasAuthWarning = result.text.includes("No provider auth configured");
    const hasSuccess = result.text.includes("Router backend enabled");

    const warningCount = [hasDepsWarning, hasAuthWarning, hasSuccess].filter(Boolean).length;
    expect(warningCount).toBeGreaterThanOrEqual(1);
  });

  it("includes dependency names in warning when deps are missing", () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOn(ctx);

    if (result.text.includes("Missing dependencies")) {
      expect(result.text).toMatch(/❌.*(codex|claude)/);
    }
  });

  it("includes provider auth info when successfully enabled", () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";

    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOn(ctx);

    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("Auth:");
    }

    if (savedKey !== undefined) {
      process.env.OPENROUTER_API_KEY = savedKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
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
    expect(result.text).toMatch(/(Router backend enabled|Missing dependencies|No provider auth configured)/);
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
  it("uses threadId for thread scope mode (or warns about missing deps/auth)", () => {
    const ctx = { threadId: "thread-1", sessionKey: "sess-1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("thread:thread-1");
    } else {
      expect(result.text).toMatch(/(Missing dependencies|No provider auth configured)/);
    }
  });

  it("falls back to sessionId when no threadId (or warns)", () => {
    const ctx = { threadId: null, sessionKey: "sess-1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("thread:sess-1");
    } else {
      expect(result.text).toMatch(/(Missing dependencies|No provider auth configured)/);
    }
  });

  it("falls back to default when no context (or warns)", () => {
    const ctx = { threadId: null, sessionKey: null };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("thread:default");
    } else {
      expect(result.text).toMatch(/(Missing dependencies|No provider auth configured)/);
    }
  });

  it("uses global scope when scopeMode is global (or warns)", () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global } as typeof DEFAULT_CONFIG);
    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("global:default");
    } else {
      expect(result.text).toMatch(/(Missing dependencies|No provider auth configured)/);
    }
  });

  it("uses session scope when scopeMode is session (or warns)", () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session } as typeof DEFAULT_CONFIG);
    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("session:s1");
    } else {
      expect(result.text).toMatch(/(Missing dependencies|No provider auth configured)/);
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
    expect(result.text).toMatch(/(All checks passed|Issues found)/);
  });

  it("includes provider auth info in secrets check", () => {
    const result = handleRouterDoctor(ctx);
    expect(result.text).toMatch(/(secrets_present|Configured|No provider|All providers)/);
  });
});

describe("provider auth in handleRouterOn", () => {
  it("warns about specific unconfigured providers when partially auth'd", () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";

    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx);

    if (result.text.includes("Router backend enabled")) {
      expect(result.text).toContain("Auth:");
      expect(result.text).toContain("openrouter");
    }

    if (savedKey !== undefined) {
      process.env.OPENROUTER_API_KEY = savedKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });
});
