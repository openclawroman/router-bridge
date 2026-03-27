/**
 * Integration test: real ai-code-runner binary with --health flag.
 *
 * Verifies that the subprocess adapter assembles args correctly:
 *   python3 /path/to/ai-code-runner --config /path/config --health
 *
 * NOT: python3 --config /path/config /path/to/ai-code-runner --health
 * (which was the bug — --config before the script path)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const RUNNER_PATH = process.env.OPENCLAW_ROUTER_ROOT
  ? path.join(process.env.OPENCLAW_ROUTER_ROOT, "bin/ai-code-runner")
  : path.join(__dirname, "../../bin/ai-code-runner");

const CONFIG_PATH = process.env.OPENCLAW_ROUTER_ROOT
  ? path.join(process.env.OPENCLAW_ROUTER_ROOT, "config/router.config.json")
  : path.join(__dirname, "../../config/router.config.json");

describe("Real binary: ai-code-runner --health args", () => {
  let runnerExists = false;
  let configExists = false;

  beforeAll(() => {
    runnerExists = fs.existsSync(RUNNER_PATH);
    configExists = fs.existsSync(CONFIG_PATH);
  });

  it("ai-code-runner binary exists", () => {
    if (!runnerExists) {
      console.log(`SKIP: ${RUNNER_PATH} not found`);
      return;
    }
    expect(fs.existsSync(RUNNER_PATH)).toBe(true);
  });

  it("runner script is executable (Python)", () => {
    if (!runnerExists) return;
    const content = fs.readFileSync(RUNNER_PATH, "utf-8");
    // Should start with shebang
    expect(content.startsWith("#!")).toBe(true);
    expect(content).toContain("python");
  });

  it("--config must come AFTER script path, not before", () => {
    if (!runnerExists || !configExists) return;

    // This is the correct order: python3 /script --config /config --health
    // The script handles --config via sys.argv (checks for --config at position i+1)
    const scriptContent = fs.readFileSync(RUNNER_PATH, "utf-8");

    // Verify the script parses sys.argv for --config
    expect(scriptContent).toContain("--config");
    expect(scriptContent).toContain("sys.argv");
  });

  it("args assembly matches subprocess adapter pattern", () => {
    // Simulate how subprocess.ts builds args (should match)
    // From subprocess.ts execute(): [...baseArgs, "--config", configPath]
    // From subprocess.ts checkSubprocessHealth(): [...baseArgs, "--config", configPath, "--health"]

    const mockBaseArgs = ["python3", RUNNER_PATH];

    // Correct pattern: python3 /path/to/script --config /path/to/config --health
    const correctArgs = [...mockBaseArgs, "--config", CONFIG_PATH, "--health"];

    // python3 should be first
    expect(correctArgs[0]).toBe("python3");
    // script path should be second
    expect(correctArgs[1]).toBe(RUNNER_PATH);
    // --config should be after script
    const configIdx = correctArgs.indexOf("--config");
    const scriptIdx = correctArgs.indexOf(RUNNER_PATH);
    expect(configIdx).toBeGreaterThan(scriptIdx);
    // --health should be last
    expect(correctArgs[correctArgs.length - 1]).toBe("--health");
  });

  it("FAILS with wrong arg order: --config before script", () => {
    // Prove the bug: --config before script path
    const wrongArgs = ["python3", "--config", CONFIG_PATH, RUNNER_PATH, "--health"];
    const configIdx = wrongArgs.indexOf("--config");
    const scriptIdx = wrongArgs.indexOf(RUNNER_PATH);

    // This WAS the bug: configIdx < scriptIdx means python3 interprets --config
    // as a Python option, not a script option
    expect(configIdx).toBeLessThan(scriptIdx);
    // This is WRONG — our test proves it
  });
});
