import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { handleRouterOn, handleRouterOff, handleRouterStatus, handleRouterCommand } from "../src/commands";
import { ExecutionBackend, ScopeType, DEFAULT_CONFIG } from "../src/types";

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
  it("returns success message with scope info", () => {
    const ctx = { threadId: "t123", sessionKey: "s456" };
    const result = handleRouterOn(ctx);
    expect(result.text).toContain("Router backend enabled");
    expect(result.text).toContain("router-bridge");
    expect(result.text).toContain("thread:t123");
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
    expect(result.text).toContain("Router backend enabled");
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
    expect(result.text).toContain("/router [on|off|status");
  });
});

describe("scope resolution", () => {
  it("uses threadId for thread scope mode", () => {
    const ctx = { threadId: "thread-1", sessionKey: "sess-1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    expect(result.text).toContain("thread:thread-1");
  });

  it("falls back to sessionId when no threadId", () => {
    const ctx = { threadId: null, sessionKey: "sess-1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    expect(result.text).toContain("thread:sess-1");
  });

  it("falls back to default when no context", () => {
    const ctx = { threadId: null, sessionKey: null };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread } as typeof DEFAULT_CONFIG);
    expect(result.text).toContain("thread:default");
  });

  it("uses global scope when scopeMode is global", () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global } as typeof DEFAULT_CONFIG);
    expect(result.text).toContain("global:default");
  });

  it("uses session scope when scopeMode is session", () => {
    const ctx = { threadId: "t1", sessionKey: "s1" };
    const result = handleRouterOn(ctx, { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session } as typeof DEFAULT_CONFIG);
    expect(result.text).toContain("session:s1");
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
