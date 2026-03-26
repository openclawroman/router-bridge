import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadEnvFile, checkSecrets, validateSecrets, REQUIRED_SECRETS, OPTIONAL_SECRETS, ALL_SECRETS } from "../src/secrets";

let tmpDir: string;
let envFile: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-test-"));
  envFile = path.join(tmpDir, "router.env");
  // Save and clear env vars
  for (const key of ALL_SECRETS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  // Restore env vars
  for (const key of ALL_SECRETS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
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
    fs.writeFileSync(envFile, [
      "# This is a comment",
      "",
      "OPENROUTER_API_KEY=sk-or-fromfile",
      "   ",
      "# Another comment",
      "UNKNOWN_KEY=should-be-ignored",
    ].join("\n"));
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

describe("validateSecrets", () => {
  it("does not throw when all required secrets are present", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(() => validateSecrets()).not.toThrow();
  });

  it("throws on missing required secrets", () => {
    expect(() => validateSecrets()).toThrow(/Missing required secrets.*OPENROUTER_API_KEY/);
  });
});
