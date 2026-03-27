/**
 * E2E test harness — helpers for integration tests.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createFakeOpenClawApi, FakeOpenClawApi } from "../fixtures/fake-openclaw-api";
import { DEFAULT_CONFIG, type PluginConfig } from "../../src/types";

// ─── createTempDir ─────────────────────────────────────────────────
/**
 * Create an isolated temporary directory.  Caller should clean up via
 * `fs.rmSync(tmpDir, { recursive: true, force: true })` in afterAll/afterEach.
 */
export function createTempDir(prefix = "rb-e2e-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Backward-compatible alias */
export const createTmpDir = createTempDir;

// ─── setupTestEnv ──────────────────────────────────────────────────
/**
 * Bootstrap a minimal runtime directory tree under `tmpDir` and write a
 * `router.config.json` that `getConfig()` would pick up.
 *
 * Returns the resolved `PluginConfig` (DEFAULT_CONFIG merged with overrides).
 */
export function setupTestEnv(
  tmpDir: string,
  overrides: Partial<PluginConfig> = {},
): PluginConfig {
  // Create the directory structure the bridge expects at runtime
  const dirs = ["config", "bin", "data", "logs"];
  for (const d of dirs) {
    fs.mkdirSync(path.join(tmpDir, d), { recursive: true });
  }

  // Build the merged config
  const config: PluginConfig = { ...DEFAULT_CONFIG, ...overrides };

  // Point paths into the temp dir when not explicitly overridden
  if (!overrides.routerCommand) {
    config.routerCommand = path.join(tmpDir, "bin", "ai-code-runner");
  }
  if (!overrides.routerConfigPath) {
    config.routerConfigPath = path.join(tmpDir, "config", "router.config.json");
  }

  // Write the router config file
  fs.mkdirSync(path.dirname(config.routerConfigPath), { recursive: true });
  fs.writeFileSync(config.routerConfigPath, JSON.stringify(config, null, 2));

  return config;
}

// ─── makeCodingCtx ─────────────────────────────────────────────────
/**
 * Return a lightweight coding-context object that satisfies the shape
 * the bridge's hooks read from `ctx`.
 */
export function makeCodingCtx(
  overrides: Partial<{
    userMessage: string;
    prompt: string;
    threadId: string;
    sessionKey: string;
    messageId: string;
  }> = {},
) {
  return {
    userMessage: overrides.userMessage ?? "Implement a TypeScript helper function",
    prompt: overrides.prompt ?? "Implement a TypeScript helper function",
    threadId: overrides.threadId ?? "thread-1",
    sessionKey: overrides.sessionKey ?? "session-1",
    messageId: overrides.messageId ?? "msg-1",
  };
}

// ─── writeExecutableShim ───────────────────────────────────────────
/**
 * Write a file to `binDir/name` and mark it executable (chmod 0o755).
 * `content` is written as-is (should start with a shebang if it needs one).
 */
export function writeExecutableShim(
  binDir: string,
  name: string,
  content: string,
): string {
  fs.mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, name);
  fs.writeFileSync(filePath, content, { encoding: "utf-8" });
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

// ─── makeFakeApi ───────────────────────────────────────────────────
/**
 * Convenience wrapper — create a fake API with plugin config overrides
 * pre-wired into the config path getConfig() reads.
 */
export function makeFakeApi(
  pluginConfigOverrides: Record<string, any> = {},
): FakeOpenClawApi {
  return createFakeOpenClawApi(pluginConfigOverrides);
}
