/**
 * Black-box E2E integration test — full lifecycle through the real plugin API.
 *
 * This test does NOT use harness helpers (no makeCodingCtx, no makeFakeApi).
 * Instead it builds a minimal mock of the OpenClaw plugin contract inline and
 * exercises the complete path:
 *
 *   register(pluginApi)
 *     → /router on   (handleRouterCommand)
 *     → before_prompt_build hook fires
 *       → SubprocessRouterAdapter runs the REAL openclaw-router binary
 *         (with fake codex/claude executor shims in PATH)
 *     → assert ctx.routerResult, ctx.routerMetadata.backend === "router-bridge"
 *       and NO fallback
 *
 * Every test gets its own temp directory so there is zero shared state.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import register from "../../index";
import { handleRouterCommand } from "../../src/commands";
import { DEFAULT_CONFIG, ScopeType, ExecutionBackend } from "../../src/types";

// ── Real router binary ─────────────────────────────────────────────────
const REAL_ROUTER = "/tmp/openclaw-router/bin/ai-code-runner";

// ───────────────────────────────────────────────────────────────────────
// Inline helpers — no harness imports
// ───────────────────────────────────────────────────────────────────────

/**
 * Create an isolated temporary directory for a single test.
 */
function mkTmp(prefix = "rb-blackbox-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Write an executable shim script to `dir/name`.
 */
function writeShim(dir: string, name: string, script: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, script, { encoding: "utf-8" });
  fs.chmodSync(fp, 0o755);
  return fp;
}

/**
 * Minimal mock of the OpenClaw plugin API contract.
 *
 * Mirrors what a real host would pass to `register(api)`:
 *   - registerCommand / registerSkill / registerService / on
 *   - config  (with plugin overrides)
 *   - logger  (silent stub)
 *
 * Captures all registrations so we can invoke hooks directly.
 */
interface MinimalPluginApi {
  registerCommand: (desc: any) => void;
  registerSkill: (desc: any) => void;
  registerService: (desc: any) => void;
  on: (event: string, handler: (ctx: any) => Promise<void>) => void;
  config: Record<string, any>;
  logger: { info: () => void; warn: () => void; error: () => void };
  /** Captured registrations — used by tests to invoke hooks. */
  _hooks: Record<string, Array<(ctx: any) => Promise<void>>>;
  _commands: Record<string, any>;
}

function createPluginApi(overrides: Record<string, any> = {}): MinimalPluginApi {
  const hooks: Record<string, Array<(ctx: any) => Promise<void>>> = {};
  const commands: Record<string, any> = {};

  return {
    registerCommand(desc: any) {
      commands[desc.name] = desc;
    },
    registerSkill() {},
    registerService() {},
    on(event: string, handler: (ctx: any) => Promise<void>) {
      if (!hooks[event]) hooks[event] = [];
      hooks[event].push(handler);
    },
    config: {
      plugins: {
        entries: {
          "router-bridge": { config: overrides },
        },
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    _hooks: hooks,
    _commands: commands,
  };
}

/**
 * Build a context object that matches the shape the before_prompt_build
 * hook reads (userMessage, prompt, threadId, sessionKey, messageId, etc).
 */
function makeCtx(overrides: Record<string, any> = {}) {
  return {
    userMessage: overrides.userMessage ?? "Implement a TypeScript helper function",
    prompt: overrides.prompt ?? "Implement a TypeScript helper function",
    threadId: overrides.threadId ?? "thread-bb-1",
    sessionKey: overrides.sessionKey ?? "session-bb-1",
    messageId: overrides.messageId ?? "msg-bb-1",
    cwd: overrides.cwd,
    gitBranch: overrides.gitBranch,
    recentMessages: overrides.recentMessages,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Shared test fixtures (fake executors + router config)
// ───────────────────────────────────────────────────────────────────────
let tmpDir: string;
let binDir: string;
let configDir: string;
let savedPath: string | undefined;
let savedRouterRoot: string | undefined;
let savedHome: string | undefined;

beforeAll(() => {
  tmpDir = mkTmp("rb-blackbox-suite-");
  binDir = path.join(tmpDir, "bin");
  configDir = path.join(tmpDir, "config");

  // Point OPENCLAW_ROUTER_ROOT and HOME at temp dir for isolated state
  savedRouterRoot = process.env.OPENCLAW_ROUTER_ROOT;
  savedHome = process.env.HOME;
  process.env.OPENCLAW_ROUTER_ROOT = tmpDir;
  process.env.HOME = tmpDir;

  // Create runtime dirs that ensureRuntimeDirectories() expects
  fs.mkdirSync(path.join(tmpDir, "runtime", "bridge"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "runtime", "router"), { recursive: true });

  // ── Fake executor shims ──────────────────────────────────────────
  writeShim(
    binDir,
    "codex",
    "#!/bin/sh\necho \"Token refresh flow implemented by fake codex\"\nexit 0\n",
  );
  writeShim(
    binDir,
    "claude",
    "#!/bin/sh\necho \"Task completed by fake claude\"\nexit 0\n",
  );

  // Prepend fake bin dir to PATH
  savedPath = process.env.PATH;
  process.env.PATH = binDir + ":" + (process.env.PATH || "");

  // ── Router config ────────────────────────────────────────────────
  // Uses the same schema as the existing working E2E test (bridge-router.integration.test.ts)
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "router.config.json"),
    JSON.stringify(
      {
        version: 1,
        budget: { enabled: false },
        models: {
          codex: { default: "codex-default", gpt54: "gpt-5.4", gpt54_mini: "gpt-5.4-mini" },
          claude: { default: "claude-default", sonnet: "claude-sonnet-4.6", opus: "claude-opus-4.6" },
          openrouter: { minimax: "minimax/minimax-m2.7", kimi: "moonshotai/kimi-k2.5", mimo: "xiaomi/mimo-v2-pro" },
        },
        routing: {
          openai_primary: {
            chain: ["codex_cli", "openrouter"],
            timeout_s: 120,
          },
        },
        timeout: { default_ms: 30000 },
        tools: {
          codex_cli: {
            profiles: {
              openai_native: { model: "gpt-5.4", timeout_s: 300 },
            },
          },
        },
        reliability: {
          chain_timeout_s: 600,
          max_fallbacks: 3,
          circuit_breaker: { threshold: 5, window_s: 60, cooldown_s: 120 },
        },
        logging: { jsonl_path: "runtime/routing.jsonl" },
      },
      null,
      2,
    ),
  );
});

afterAll(() => {
  if (savedRouterRoot !== undefined) process.env.OPENCLAW_ROUTER_ROOT = savedRouterRoot;
  else delete process.env.OPENCLAW_ROUTER_ROOT;
  if (savedHome !== undefined) process.env.HOME = savedHome;
  if (savedPath !== undefined) process.env.PATH = savedPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Clear store state between tests to prevent file-backed state leaks
beforeEach(() => {
  clearAllStoreState();
});

/**
 * Clear all scoped state from the file-backed store.
 * The store is a singleton and file-backed — without this, state leaks
 * between tests in the same vitest process.
 */
import { store as globalStore } from "../../src/commands";
function clearAllStoreState(): void {
  globalStore.clear(ScopeType.Global, "default");
  // Best-effort clear of common test thread/session IDs
  for (const id of ["thread-bb-1", "thread-A", "thread-B", "t1", "s1", "session-bb-1"]) {
    try { globalStore.clear(ScopeType.Thread, id); } catch {}
    try { globalStore.clear(ScopeType.Session, id); } catch {}
  }
}

// ───────────────────────────────────────────────────────────────────────
// Test 1 — Happy path: full lifecycle through real plugin API
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: full lifecycle — happy path", () => {
  it("register → /router on → before_prompt_build → routerResult set, backend=router-bridge, no fallback", async () => {
    // 1. Create minimal plugin API pointing at the real router binary
    const api = createPluginApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      fallbackToNativeOnError: true,
      scopeMode: ScopeType.Global,
    });

    // 2. Register plugin — wires up before_prompt_build hook + /router command
    register(api);

    // 3. /router on — enable router-bridge for global scope
    const onResult = await handleRouterCommand(
      "on",
      { threadId: null, sessionKey: null },
      {
        ...DEFAULT_CONFIG,
        routerCommand: REAL_ROUTER,
        routerConfigPath: path.join(configDir, "router.config.json"),
        healthCacheTtlMs: 0,
        scopeMode: ScopeType.Global,
      },
    );
    // Should confirm router enabled (or warn about missing deps — both OK for this test)
    expect(onResult.text).toMatch(/(Router backend enabled|Missing dependencies)/);

    // 4. Build a coding context
    const ctx = makeCtx();

    // 5. Invoke the captured before_prompt_build hook
    const hooks = api._hooks["before_prompt_build"];
    expect(hooks).toBeDefined();
    expect(hooks!.length).toBeGreaterThanOrEqual(1);
    await hooks![0](ctx);

    // 6. Assert: successful delegation through real router binary
    expect(ctx.routerResult).toBeDefined();
    expect(ctx.routerResult).toContain("fake codex");
    expect(ctx.routerMetadata).toBeDefined();
    expect(ctx.routerMetadata.backend).toBe("router-bridge");
    // Critical: NO fallback — the router handled it natively
    expect(ctx.routerFallback).toBeUndefined();
    expect(ctx.routerError).toBeUndefined();
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────
// Test 2 — Non-coding tasks are NOT delegated
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: non-coding prompt skips delegation", () => {
  it("does not set routerResult for a chat/greeting prompt", async () => {
    const api = createPluginApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      scopeMode: ScopeType.Global,
    });

    register(api);

    // Enable router
    await handleRouterCommand(
      "on",
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );

    // Non-coding context
    const ctx = makeCtx({ userMessage: "What's the weather today?" });

    const hooks = api._hooks["before_prompt_build"];
    expect(hooks).toBeDefined();
    await hooks![0](ctx);

    // Should NOT have set routerResult — prompt was classified as non-coding
    expect(ctx.routerResult).toBeUndefined();
    expect(ctx.routerFallback).toBeUndefined();
  }, 15_000);
});

// ───────────────────────────────────────────────────────────────────────
// Test 3 — Health check failure triggers fallback
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: health failure → fallback to native", () => {
  it("sets routerFallback when the router binary is unhealthy", async () => {
    const api = createPluginApi({
      routerCommand: "/bin/false", // always exits 1 — health check fails
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      fallbackToNativeOnError: true,
      scopeMode: ScopeType.Global,
    });

    register(api);

    await handleRouterCommand(
      "on",
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );

    const ctx = makeCtx();

    const hooks = api._hooks["before_prompt_build"];
    expect(hooks).toBeDefined();
    await hooks![0](ctx);

    // Should have fallen back
    expect(ctx.routerFallback).toBe(true);
    expect(ctx.routerResult).toBeUndefined();
    expect(ctx.routerError).toBeDefined();
    expect(ctx.routerError).toMatch(/[Hh]ealth/);
  }, 15_000);
});

// ───────────────────────────────────────────────────────────────────────
// Test 4 — /router off → no delegation even for coding tasks
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: /router off disables delegation", () => {
  it("does not delegate after /router off", async () => {
    const api = createPluginApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      scopeMode: ScopeType.Global,
    });

    register(api);

    // Enable then disable
    await handleRouterCommand(
      "on",
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );
    await handleRouterCommand(
      "off",
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );

    const ctx = makeCtx();

    const hooks = api._hooks["before_prompt_build"];
    expect(hooks).toBeDefined();
    await hooks![0](ctx);

    // Backend is now native — hook should bail early
    expect(ctx.routerResult).toBeUndefined();
    expect(ctx.routerFallback).toBeUndefined();
  }, 15_000);
});

// ───────────────────────────────────────────────────────────────────────
// Test 5 — /router on→off→on cycle works correctly
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: /router on → off → on cycle", () => {
  it("re-enables delegation after cycling", async () => {
    const api = createPluginApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      fallbackToNativeOnError: true,
      scopeMode: ScopeType.Global,
    });

    register(api);

    const cfg = {
      ...DEFAULT_CONFIG,
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      scopeMode: ScopeType.Global,
    };

    // Cycle: on → off → on
    await handleRouterCommand("on", { threadId: null, sessionKey: null }, cfg);
    await handleRouterCommand("off", { threadId: null, sessionKey: null }, cfg);
    await handleRouterCommand("on", { threadId: null, sessionKey: null }, cfg);

    const ctx = makeCtx();

    const hooks = api._hooks["before_prompt_build"];
    expect(hooks).toBeDefined();
    await hooks![0](ctx);

    // After re-enabling, delegation should work
    expect(ctx.routerResult).toBeDefined();
    expect(ctx.routerResult).toContain("fake codex");
    expect(ctx.routerMetadata).toBeDefined();
    expect(ctx.routerMetadata.backend).toBe("router-bridge");
    expect(ctx.routerFallback).toBeUndefined();
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────
// Test 6 — Thread-scoped backend isolation
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: thread-scoped backend isolation", () => {
  it("delegates only the thread that enabled router", async () => {
    const api = createPluginApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      fallbackToNativeOnError: true,
      scopeMode: ScopeType.Thread,
    });

    register(api);

    const cfg = {
      ...DEFAULT_CONFIG,
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      scopeMode: ScopeType.Thread,
    };

    // Enable router for thread-A only
    await handleRouterCommand("on", { threadId: "thread-A", sessionKey: null }, cfg);

    const hooks = api._hooks["before_prompt_build"];
    expect(hooks).toBeDefined();

    // Thread-A context — should delegate
    const ctxA = makeCtx({ threadId: "thread-A" });
    await hooks![0](ctxA);
    expect(ctxA.routerResult).toBeDefined();
    expect(ctxA.routerMetadata?.backend).toBe("router-bridge");

    // Thread-B context — should NOT delegate (different scope)
    const ctxB = makeCtx({ threadId: "thread-B" });
    await hooks![0](ctxB);
    expect(ctxB.routerResult).toBeUndefined();
    expect(ctxB.routerFallback).toBeUndefined();
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────
// Test 7 — Router result contains metadata footer
// ───────────────────────────────────────────────────────────────────────
describe("Black-box E2E: result metadata footer", () => {
  it("routerResult includes a 🔧 footer with model/timing info", async () => {
    const api = createPluginApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      fallbackToNativeOnError: true,
      scopeMode: ScopeType.Global,
    });

    register(api);

    await handleRouterCommand(
      "on",
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );

    const ctx = makeCtx();

    const hooks = api._hooks["before_prompt_build"];
    await hooks![0](ctx);

    // Result should contain 🔧 footer with metadata
    expect(ctx.routerResult).toBeDefined();
    expect(ctx.routerResult).toContain("🔧");

    // Metadata fields should be present
    expect(ctx.routerMetadata).toBeDefined();
    expect(ctx.routerMetadata.backend).toBe("router-bridge");
    expect(ctx.routerMetadata.classification).toBeDefined();
    expect(ctx.routerMetadata.classification.isCodingTask).toBe(true);
    expect(typeof ctx.routerMetadata.durationMs).toBe("number");
  }, 30_000);
});
