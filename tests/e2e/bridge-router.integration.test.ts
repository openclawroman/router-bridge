/**
 * E2E integration test: router-bridge + openclaw-router subprocess.
 *
 * No mocking of bridge internals. Only fakes: OpenClaw API, executor CLIs.
 * The real code paths exercised:
 *   - register() (root index.ts)
 *   - shouldDelegateToExecutionBackend() (policy.ts)
 *   - createAdapter() (adapters/factory.ts)
 *   - SubprocessRouterAdapter (adapters/subprocess.ts)
 *   - classifyTask() (policy.ts)
 *   - before_prompt_build hook (registered by register())
 *
 * Test 1 uses the REAL openclaw-router binary with fake codex/claude
 * executor shims so no real provider/API is needed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import register from "../../index";
import { handleRouterOn } from "../../src/commands";
import { DEFAULT_CONFIG, ScopeType } from "../../src/types";
import {
  createTmpDir,
  writeExecutableShim,
  makeCodingCtx,
  makeFakeApi,
} from "./harness";

// ── Real router path ─────────────────────────────────────────────────
const REAL_ROUTER = "/tmp/openclaw-router/bin/ai-code-runner";

// ── Shared temp state ─────────────────────────────────────────────────
let tmpDir: string;
let binDir: string;
let configDir: string;
let savedPath: string | undefined;
let savedRouterRoot: string | undefined;
let savedHome: string | undefined;

beforeAll(() => {
  tmpDir = createTmpDir("rb-e2e-");
  binDir = path.join(tmpDir, "bin");
  configDir = path.join(tmpDir, "config");

  // Point OPENCLAW_ROUTER_ROOT at our temp dir so store.ts writes state there
  savedRouterRoot = process.env.OPENCLAW_ROUTER_ROOT;
  savedHome = process.env.HOME;
  process.env.OPENCLAW_ROUTER_ROOT = tmpDir;
  // HOME must also be set because DEFAULT_CONFIG expands ~ via process.env.HOME
  process.env.HOME = tmpDir;

  // Create runtime dirs that ensureRuntimeDirectories() expects
  fs.mkdirSync(path.join(tmpDir, "runtime", "bridge"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "runtime", "router"), { recursive: true });

  // ── Fake executor shims ──────────────────────────────────────────
  // These match the CLI conventions the real openclaw-router expects:
  //   codex [--model X] SUMMARY   → prints success to stdout, exits 0
  //   claude -p SUMMARY           → prints success to stdout, exits 0
  writeExecutableShim(
    binDir,
    "codex",
    "#!/bin/sh\necho \"Token refresh flow implemented by fake codex\"\nexit 0\n",
  );
  writeExecutableShim(
    binDir,
    "claude",
    "#!/bin/sh\necho \"Task completed by fake claude\"\nexit 0\n",
  );

  // Prepend fake bin dir to PATH so the router finds our shims first
  savedPath = process.env.PATH;
  process.env.PATH = binDir + ":" + (process.env.PATH || "");

  // Write a minimal router.config.json that the real router can load
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
  // Restore env
  if (savedRouterRoot !== undefined) process.env.OPENCLAW_ROUTER_ROOT = savedRouterRoot;
  else delete process.env.OPENCLAW_ROUTER_ROOT;
  if (savedHome !== undefined) process.env.HOME = savedHome;
  if (savedPath !== undefined) process.env.PATH = savedPath;

  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Test 1: happy path (real router + fake executors) ─────────────────
describe("E2E: happy path — delegate coding task through real router binary", () => {
  it("delegates coding task through real router with fake codex executor", async () => {
    // 1. Create fake OpenClaw API pointing at the real router binary
    const api = makeFakeApi({
      routerCommand: REAL_ROUTER,
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0, // no caching for test isolation
    });

    // 2. Call register(fakeApi) — this wires up the before_prompt_build hook
    register(api);

    // 3. Enable router for the global scope
    handleRouterOn(
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );

    // 4. Create coding context
    const ctx = makeCodingCtx();

    // 5. Invoke the captured before_prompt_build hook directly
    const hooks = api.handlers.eventHandlers["before_prompt_build"];
    expect(hooks).toBeDefined();
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    await hooks[0](ctx);

    // 6. Assert: successful delegation via real router + fake codex
    expect(ctx.routerResult).toBeDefined();
    expect(ctx.routerResult).toContain("fake codex");
    expect(ctx.routerMetadata).toBeDefined();
    expect(ctx.routerMetadata.backend).toBe("router-bridge");
    expect(ctx.routerFallback).toBeUndefined();
    expect(ctx.routerError).toBeUndefined();
  });
});

// ── Test 2: health/fallback path ──────────────────────────────────────
describe("E2E: health check failure — falls back to native", () => {
  it("falls back to native when health check fails", async () => {
    // 1. Create fake API — routerCommand points to /bin/false (always exits 1)
    const api = makeFakeApi({
      routerCommand: "/bin/false",
      routerConfigPath: path.join(configDir, "router.config.json"),
      healthCacheTtlMs: 0,
      fallbackToNativeOnError: true,
    });

    // 2. Call register(fakeApi)
    register(api);

    // 3. Enable router for the global scope
    handleRouterOn(
      { threadId: null, sessionKey: null },
      { ...DEFAULT_CONFIG, scopeMode: ScopeType.Global },
    );

    // 4. Create coding context
    const ctx = makeCodingCtx();

    // 5. Invoke the captured before_prompt_build hook
    const hooks = api.handlers.eventHandlers["before_prompt_build"];
    expect(hooks).toBeDefined();
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    await hooks[0](ctx);

    // 6. Assert: fell back to native
    expect(ctx.routerFallback).toBe(true);
    expect(ctx.routerResult).toBeUndefined();
    expect(ctx.routerError).toBeDefined();
    expect(ctx.routerError).toMatch(/[Hh]ealth/);
  });
});
