import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadEnvFile, checkSecrets, validateSecrets, REQUIRED_SECRETS, OPTIONAL_SECRETS, ALL_SECRETS,
  checkProviderAuth, checkCodexAuth, checkClaudeAuth, hasAnyProviderAuth, getConfiguredProviders, getUnconfiguredProviders,
  type ProviderAuthStatus,
} from "../src/secrets";

let tmpDir: string;
let envFile: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-test-"));
  envFile = path.join(tmpDir, "router.env");
  for (const key of ALL_SECRETS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  savedEnv["OPENAI_API_KEY"] = process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
});

afterEach(() => {
  for (const key of ALL_SECRETS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
  if (savedEnv["OPENAI_API_KEY"] !== undefined) {
    process.env["OPENAI_API_KEY"] = savedEnv["OPENAI_API_KEY"];
  } else {
    delete process.env["OPENAI_API_KEY"];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadEnvFile", () => {
  it("loads secrets from file", () => {
    fs.writeFileSync(envFile, "OPENROUTER_API_KEY=sk-or-test123\nANTHROPIC_API_KEY=sk-ant-test456\n");
    const loaded = loadEnvFile(envFile);
    expect(loaded).toContain("OPENROUTER_API_KEY");
    expect(loaded).toContain("ANTHROPIC_API_KEY");
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-test123");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test456");
  });

  it("skips already-set env vars", () => {
    process.env.OPENROUTER_API_KEY = "already-set";
    fs.writeFileSync(envFile, "OPENROUTER_API_KEY=sk-or-new\n");
    const loaded = loadEnvFile(envFile);
    expect(loaded).toHaveLength(0);
    expect(process.env.OPENROUTER_API_KEY).toBe("already-set");
  });

  it("ignores comments and empty lines", () => {
    fs.writeFileSync(envFile, "# This is a comment\n\nOPENROUTER_API_KEY=sk-or-fromfile\n   \n# Another comment\nUNKNOWN_KEY=should-be-ignored\n");
    const loaded = loadEnvFile(envFile);
    expect(loaded).toEqual(["OPENROUTER_API_KEY"]);
  });

  it("returns empty for non-existent file", () => {
    const loaded = loadEnvFile("/nonexistent/path/router.env");
    expect(loaded).toEqual([]);
  });
});

describe("checkSecrets", () => {
  it("reports correct status when secrets are present", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const statuses = checkSecrets();
    const orKey = statuses.find(s => s.name === "OPENROUTER_API_KEY");
    expect(orKey?.present).toBe(true);
    expect(orKey?.required).toBe(true);
    expect(orKey?.source).toBe("process");
  });

  it("reports missing status when secrets are absent", () => {
    const statuses = checkSecrets();
    const orKey = statuses.find(s => s.name === "OPENROUTER_API_KEY");
    expect(orKey?.present).toBe(false);
    expect(orKey?.required).toBe(true);
    expect(orKey?.source).toBe("missing");
  });

  it("loads env file when path provided", () => {
    fs.writeFileSync(envFile, "OPENROUTER_API_KEY=sk-or-loaded\n");
    const statuses = checkSecrets(envFile);
    const orKey = statuses.find(s => s.name === "OPENROUTER_API_KEY");
    expect(orKey?.present).toBe(true);
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-loaded");
  });
});

describe("validateSecrets (provider-aware)", () => {
  it("does not throw when OPENROUTER_API_KEY is present", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(() => validateSecrets()).not.toThrow();
  });

  it("does not throw when ANTHROPIC_API_KEY is present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(() => validateSecrets()).not.toThrow();
  });

  it("throws when no provider auth is configured at all", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    expect(() => validateSecrets()).toThrow(/No provider auth configured/);
    process.env.HOME = savedHome;
  });
});

describe("checkCodexAuth", () => {
  it("returns true when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(checkCodexAuth()).toBe(true);
  });

  it("returns false when no auth is configured", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    expect(checkCodexAuth()).toBe(false);
    process.env.HOME = savedHome;
  });

  it("returns true when ~/.codex/config exists and is non-empty", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const codexDir = path.join(tmpDir, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, "config"), '{"some": "config"}');
    expect(checkCodexAuth()).toBe(true);
    process.env.HOME = savedHome;
  });
});

describe("checkClaudeAuth", () => {
  it("returns true when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(checkClaudeAuth()).toBe(true);
  });

  it("returns false when no auth is configured", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    expect(checkClaudeAuth()).toBe(false);
    process.env.HOME = savedHome;
  });

  it("returns true when ~/.config/claude/credentials exists and is non-empty", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const claudeDir = path.join(tmpDir, ".config", "claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "credentials"), "some-credentials");
    expect(checkClaudeAuth()).toBe(true);
    process.env.HOME = savedHome;
  });
});

describe("checkProviderAuth", () => {
  it("returns array of three providers", () => {
    const result = checkProviderAuth();
    expect(result).toHaveLength(3);
    expect(result.map(p => p.provider)).toEqual(["codex_cli", "claude_code", "openrouter"]);
  });

  it("each entry has required fields", () => {
    const result = checkProviderAuth();
    for (const p of result) {
      expect(p).toHaveProperty("provider");
      expect(p).toHaveProperty("configured");
      expect(p).toHaveProperty("method");
      expect(typeof p.configured).toBe("boolean");
      expect(typeof p.method).toBe("string");
    }
  });

  it("reports openrouter as configured when OPENROUTER_API_KEY is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const result = checkProviderAuth();
    const or = result.find(p => p.provider === "openrouter");
    expect(or?.configured).toBe(true);
  });

  it("reports openrouter as unconfigured when OPENROUTER_API_KEY is missing", () => {
    const result = checkProviderAuth();
    const or = result.find(p => p.provider === "openrouter");
    expect(or?.configured).toBe(false);
  });
});

describe("hasAnyProviderAuth", () => {
  it("returns true when OPENROUTER_API_KEY is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(hasAnyProviderAuth()).toBe(true);
  });

  it("returns true when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(hasAnyProviderAuth()).toBe(true);
  });

  it("returns false when no auth is configured", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    expect(hasAnyProviderAuth()).toBe(false);
    process.env.HOME = savedHome;
  });
});

describe("getConfiguredProviders", () => {
  it("returns list of configured providers", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const result = getConfiguredProviders();
    expect(result).toContain("openrouter");
    expect(result).toContain("claude_code");
  });

  it("returns empty when nothing configured", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    expect(getConfiguredProviders()).toEqual([]);
    process.env.HOME = savedHome;
  });
});

describe("getUnconfiguredProviders", () => {
  it("returns list of unconfigured providers", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const result = getUnconfiguredProviders();
    const names = result.map(p => p.provider);
    expect(names).not.toContain("openrouter");
  });

  it("returns all when nothing configured", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const result = getUnconfiguredProviders();
    expect(result).toHaveLength(3);
    process.env.HOME = savedHome;
  });
});
