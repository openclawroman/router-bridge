import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadEnvFile, checkSecrets, validateSecrets, REQUIRED_SECRETS, ALL_SECRETS } from "../src/secrets";

describe("secrets regression", () => {
  let tmpDir: string;
  let envFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-regression-"));
    envFile = path.join(tmpDir, "router.env");
    for (const key of ALL_SECRETS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ALL_SECRETS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadEnvFile parses KEY=VALUE lines", () => {
    fs.writeFileSync(envFile, "OPENROUTER_API_KEY=sk-or-test123\nANTHROPIC_API_KEY=sk-ant-test456\n");
    const loaded = loadEnvFile(envFile);
    expect(loaded).toContain("OPENROUTER_API_KEY");
    expect(loaded).toContain("ANTHROPIC_API_KEY");
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-test123");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test456");
  });

  it("loadEnvFile skips comments and blanks", () => {
    fs.writeFileSync(envFile, "# comment\n\nOPENROUTER_API_KEY=value\n");
    const loaded = loadEnvFile(envFile);
    expect(loaded).toEqual(["OPENROUTER_API_KEY"]);
    expect(process.env.OPENROUTER_API_KEY).toBe("value");
  });

  it("loadEnvFile returns empty when env file missing", () => {
    const loaded = loadEnvFile(path.join(tmpDir, "nonexistent"));
    expect(loaded).toEqual([]);
  });

  it("checkSecrets reports missing when required keys absent", () => {
    const statuses = checkSecrets();
    const orKey = statuses.find(s => s.name === "OPENROUTER_API_KEY");
    expect(orKey).toBeDefined();
    expect(orKey!.required).toBe(true);
    expect(orKey!.present).toBe(false);
    expect(orKey!.source).toBe("missing");
  });

  it("checkSecrets reports present when required keys set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const statuses = checkSecrets();
    const orKey = statuses.find(s => s.name === "OPENROUTER_API_KEY");
    expect(orKey!.present).toBe(true);
    expect(orKey!.source).toBe("process");
  });

  it("checkSecrets loads env file when path provided", () => {
    fs.writeFileSync(envFile, "OPENROUTER_API_KEY=sk-or-loaded\n");
    const statuses = checkSecrets(envFile);
    const orKey = statuses.find(s => s.name === "OPENROUTER_API_KEY");
    expect(orKey!.present).toBe(true);
  });

  it("validateSecrets throws when no provider auth configured", () => {
    const savedHome = process.env.HOME;
    process.env.HOME = tmpDir;
    expect(() => validateSecrets()).toThrow(/No provider auth configured/);
    process.env.HOME = savedHome;
  });

  it("validateSecrets passes when OPENROUTER_API_KEY is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(() => validateSecrets()).not.toThrow();
  });

  it("validateSecrets passes when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(() => validateSecrets()).not.toThrow();
  });
});
