import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We mock child_process so we can inspect what env is passed
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();
const mockExecSync = vi.fn(() => "/usr/bin/test");

vi.mock("child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
  execSync: (...args: any[]) => mockExecSync(...args),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
}));

import { SubprocessRouterAdapter } from "../src/adapters";

describe("OPENROUTER_API_KEY forwarding", () => {
  const savedEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    mockSpawn.mockReset();
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockExecSync.mockReturnValue("/usr/bin/test");
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = savedEnv;
    }
  });

  it("passes OPENROUTER_API_KEY to execFileSync in health check when set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key-12345";

    let capturedEnv: any = null;
    mockExecFileSync.mockImplementation((cmd: string, args: string[], opts: any) => {
      if (args?.includes("--health")) {
        capturedEnv = opts?.env;
        return "Health OK";
      }
      return "/usr/bin/test";
    });

    const adapter = new SubprocessRouterAdapter({
      routerCommand: "test-router",
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });

    await adapter.health();
    expect(capturedEnv).not.toBeNull();
    expect(capturedEnv.OPENROUTER_API_KEY).toBe("sk-test-key-12345");
  });

  it("passes empty string for OPENROUTER_API_KEY in health check when not set", async () => {
    delete process.env.OPENROUTER_API_KEY;

    let capturedEnv: any = null;
    mockExecFileSync.mockImplementation((cmd: string, args: string[], opts: any) => {
      if (args?.includes("--health")) {
        capturedEnv = opts?.env;
        return "Health OK";
      }
      return "/usr/bin/test";
    });

    const adapter = new SubprocessRouterAdapter({
      routerCommand: "test-router",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    await adapter.health();
    expect(capturedEnv).not.toBeNull();
    expect(capturedEnv.OPENROUTER_API_KEY).toBe("");
  });

  it("passes OPENROUTER_API_KEY via spawn in execute()", async () => {
    process.env.OPENROUTER_API_KEY = "sk-execute-key-67890";

    const mockChild = {
      stdin: { on: vi.fn(), write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (event === "close") setImmediate(() => cb(0));
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild);

    const adapter = new SubprocessRouterAdapter({
      routerCommand: "test-router",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    await adapter.execute({
      task: "test",
      taskId: "test-1",
      prompt: "hello",
    });

    expect(mockSpawn).toHaveBeenCalled();
    const spawnOpts = mockSpawn.mock.calls[0][2];
    expect(spawnOpts.env).toBeDefined();
    expect(spawnOpts.env.OPENROUTER_API_KEY).toBe("sk-execute-key-67890");
  });

  it("passes empty string for OPENROUTER_API_KEY in execute() when not set", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const mockChild = {
      stdin: { on: vi.fn(), write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (event === "close") setImmediate(() => cb(0));
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild);

    const adapter = new SubprocessRouterAdapter({
      routerCommand: "test-router",
      routerConfigPath: "",
      healthCacheTtlMs: 0,
    });

    await adapter.execute({
      task: "test",
      taskId: "test-2",
      prompt: "hello",
    });

    expect(mockSpawn).toHaveBeenCalled();
    const spawnOpts = mockSpawn.mock.calls[0][2];
    expect(spawnOpts.env).toBeDefined();
    expect(spawnOpts.env.OPENROUTER_API_KEY).toBe("");
  });
});
