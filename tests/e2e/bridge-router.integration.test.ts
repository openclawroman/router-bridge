/**
 * E2E integration test: router-bridge + openclaw-router subprocess.
 *
 * No mocking of bridge internals. Only fakes: OpenClaw API, router subprocess shim.
 * The real code paths exercised:
 *   - register() (root index.ts)
 *   - shouldDelegateToExecutionBackend() (policy.ts)
 *   - createAdapter() (adapters/factory.ts)
 *   - SubprocessRouterAdapter (adapters/subprocess.ts)
 *   - classifyTask() (policy.ts)
 *   - before_prompt_build hook (registered by register())
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

// ── Fake router shim ──────────────────────────────────────────────────────
// Simulates a successful openclaw-router run. Matches the JSON schema that
// SubprocessRouterAdapter.normalizeResponse() expects.
const SHIM_SCRIPT = `#!/bin/sh
# Read payload from stdin (discard — we don't need it for the shim)
cat > /dev/null
cat <<'EOF'
{"protocol_version":1,"task_id":"shim-task","tool":"codex_cli","backend":"openai_native","model_profile":"codex_primary","success":true,"normalized_error":null,"exit_code":0,"latency_ms":42,"request_id":null,"cost_estimate_usd":0.001,"artifacts":[],"stdout_ref":null,"stderr_ref":null,"final_summary":"Task completed successfully by router shim"}
EOF
`;

// ── Shared temp state ─────────────────────────────────────────────────────
let tmpDir: string;
let binDir: string;
let configDir: string;
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

  // Write a minimal router.config.json
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "router.config.json"),
    JSON.stringify({
      router_config_version: 1,
      provider: { openrouter: { api_key_env: "OPENROUTER_API_KEY" } },
      routing: {
        default_executor: "openrouter",
        rules: [{ task_class: "implementation", executor: "codex_cli" }],
      },
      timeout: { default_ms: 120_000 },
    }),
  );
});

afterAll(() => {
  // Restore env
  if (savedRouterRoot !== undefined) process.env.OPENCLAW_ROUTER_ROOT = savedRouterRoot;
  else delete process.env.OPENCLAW_ROUTER_ROOT;
  if (savedHome !== undefined) process.env.HOME = savedHome;

  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Test 1: happy path ────────────────────────────────────────────────────
describe("E2E: happy path — delegate coding task through real router subprocess", () => {
  let routerShimPath: string;

  beforeAll(() => {
    // Write the fake router shim that returns success
    routerShimPath = writeExecutableShim(binDir, "ai-code-runner", SHIM_SCRIPT);
  });

  it("delegates coding task through real router subprocess", async () => {
    // 1. Create fake OpenClaw API with config overrides
    const api = makeFakeApi({
      routerCommand: routerShimPath,
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

    // 6. Assert: successful delegation
    expect(ctx.routerResult).toBeDefined();
    expect(ctx.routerResult).toContain("Task completed successfully");
    expect(ctx.routerMetadata).toBeDefined();
    expect(ctx.routerMetadata.backend).toBe("router-bridge");
    expect(ctx.routerFallback).toBeUndefined();
    expect(ctx.routerError).toBeUndefined();
  });
});

// ── Test 2: health/fallback path ──────────────────────────────────────────
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
