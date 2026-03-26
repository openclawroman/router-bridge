import * as fs from "fs";
import * as path from "path";
import { execSync, execFileSync } from "child_process";
import type { PluginConfig } from "./types";

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

export function runDoctor(config: PluginConfig): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // 1. Python availability
  checks.push(checkPython());

  // 2. Router binary exists
  checks.push(checkRouterBinary(config));

  // 3. Config file exists
  checks.push(checkConfigFile(config));

  // 4. Runtime directory writable
  checks.push(checkRuntimeDir());

  // 5. Secrets in environment
  checks.push(checkSecrets());

  // 6. Health probe
  checks.push(checkHealthProbe(config));

  return checks;
}

function checkPython(): DoctorCheck {
  try {
    const version = execSync("python3 --version", { encoding: "utf-8" }).trim();
    const match = version.match(/Python (\d+\.\d+)/);
    const ver = match ? parseFloat(match[1]) : 0;
    return {
      name: "python_available",
      passed: ver >= 3.10,
      message: ver >= 3.10 ? `${version} ✅` : `${version} — need 3.10+`,
    };
  } catch {
    return {
      name: "python_available",
      passed: false,
      message: "python3 not found in PATH",
    };
  }
}

function checkRouterBinary(config: PluginConfig): DoctorCheck {
  const parts = config.routerCommand.trim().split(/\s+/);
  const binary = parts[0] === "python3" ? parts[1] : parts[0];

  if (!binary) {
    return { name: "router_binary", passed: false, message: "routerCommand is empty" };
  }

  const expanded = binary.replace(/^~/, process.env.HOME || "/root");

  if (fs.existsSync(expanded)) {
    return { name: "router_binary", passed: true, message: `Found: ${expanded}` };
  }

  // Try PATH
  try {
    const resolved = execSync(`which ${binary}`, { encoding: "utf-8" }).trim();
    return { name: "router_binary", passed: true, message: `Found via PATH: ${resolved}` };
  } catch {
    return {
      name: "router_binary",
      passed: false,
      message: `Not found: ${expanded}`,
      details: "Install openclaw-router or update routerCommand in config",
    };
  }
}

function checkConfigFile(config: PluginConfig): DoctorCheck {
  const expanded = config.routerConfigPath.replace(/^~/, process.env.HOME || "/root");

  if (fs.existsSync(expanded)) {
    return { name: "config_exists", passed: true, message: `Found: ${expanded}` };
  }

  return {
    name: "config_exists",
    passed: false,
    message: `Not found: ${expanded}`,
    details: "Run openclaw-router init-config or create manually",
  };
}

function checkRuntimeDir(): DoctorCheck {
  const home = process.env.HOME || "/root";
  const runtimeDir = path.join(home, ".openclaw", "router", "runtime");

  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const testFile = path.join(runtimeDir, ".write-test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    return { name: "runtime_writable", passed: true, message: `Writable: ${runtimeDir}` };
  } catch (err: any) {
    return {
      name: "runtime_writable",
      passed: false,
      message: `Cannot write: ${runtimeDir}`,
      details: err.message,
    };
  }
}

function checkSecrets(): DoctorCheck {
  const required = ["OPENROUTER_API_KEY"];
  const optional = ["ANTHROPIC_API_KEY"];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  for (const key of optional) {
    if (process.env[key]) {
      // present
    }
  }

  if (missing.length === 0) {
    return {
      name: "secrets_present",
      passed: true,
      message: `Required secrets: all present. Optional: ${optional.filter(k => process.env[k]).join(", ") || "none"}`,
    };
  }

  return {
    name: "secrets_present",
    passed: false,
    message: `Missing required: ${missing.join(", ")}`,
    details: "Set OPENROUTER_API_KEY in service environment",
  };
}

function checkHealthProbe(config: PluginConfig): DoctorCheck {
  const parts = config.routerCommand.trim().split(/\s+/);
  const executable = parts[0];
  const baseArgs = parts.slice(1);

  try {
    const output = execFileSync(executable, [...baseArgs, "--health"], {
      timeout: 10000,
      encoding: "utf-8",
    }).trim();

    const parsed = JSON.parse(output);
    return {
      name: "health_probe",
      passed: true,
      message: "Router healthy",
      details: output.substring(0, 200),
    };
  } catch (err: any) {
    return {
      name: "health_probe",
      passed: false,
      message: `Health probe failed: ${err.message}`,
      details: "Check that openclaw-router is installed and configured",
    };
  }
}
