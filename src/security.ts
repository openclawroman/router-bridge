import * as fs from "fs";
import * as path from "path";

const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI keys
  /sk-ant-[a-zA-Z0-9-]{20,}/g,      // Anthropic keys
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub tokens
  /gho_[a-zA-Z0-9]{36}/g,           // GitHub OAuth
  /ghs_[a-zA-Z0-9]{36}/g,           // GitHub App tokens
  /xox[bps]-[a-zA-Z0-9-]+/g,        // Slack tokens
  /AKIA[A-Z0-9]{16}/g,              // AWS access keys
  /[a-f0-9]{32,}/g,                  // Generic hex tokens (long)
];

/**
 * Redact secrets from a string for safe display.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.length <= 8) return "***";
      return match.substring(0, 4) + "***" + match.substring(match.length - 4);
    });
  }
  return result;
}

/**
 * Redact secrets from an object for safe display.
 */
export function redactSecretsFromObject(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = redactSecrets(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactSecretsFromObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Check file permissions for security.
 */
export function checkFilePermissions(filePath: string): { ok: boolean; issue: string | null } {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: true, issue: null }; // Doesn't exist, no issue
    }
    const stats = fs.statSync(filePath);
    const mode = stats.mode & 0o777;
    // Env files and state files should be 600 or 640
    if (filePath.endsWith(".env") || filePath.endsWith("router.env")) {
      if (mode & 0o004) {
        return { ok: false, issue: `Env file ${filePath} is world-readable (${mode.toString(8)})` };
      }
    }
    // State files should not be world-writable
    if (mode & 0o002) {
      return { ok: false, issue: `File ${filePath} is world-writable (${mode.toString(8)})` };
    }
    return { ok: true, issue: null };
  } catch {
    return { ok: true, issue: null };
  }
}

/**
 * Check directory permissions for security.
 */
export function checkDirPermissions(dirPath: string): { ok: boolean; issue: string | null } {
  try {
    if (!fs.existsSync(dirPath)) {
      return { ok: true, issue: null };
    }
    const stats = fs.statSync(dirPath);
    const mode = stats.mode & 0o777;
    if (mode & 0o002) {
      return { ok: false, issue: `Directory ${dirPath} is world-writable (${mode.toString(8)})` };
    }
    return { ok: true, issue: null };
  } catch {
    return { ok: true, issue: null };
  }
}

/**
 * Run security audit on router directory.
 */
export function auditSecurity(): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT
    || path.join(process.env.HOME || "/root", ".openclaw", "router");

  const envFile = path.join(routerRoot, "env", "router.env");
  const envCheck = checkFilePermissions(envFile);
  if (!envCheck.ok) issues.push(envCheck.issue!);

  const stateDir = path.join(routerRoot, "runtime");
  const stateDirCheck = checkDirPermissions(stateDir);
  if (!stateDirCheck.ok) issues.push(stateDirCheck.issue!);

  const stateFile = path.join(routerRoot, "runtime", "bridge", "state.json");
  const stateCheck = checkFilePermissions(stateFile);
  if (!stateCheck.ok) issues.push(stateCheck.issue!);

  return { passed: issues.length === 0, issues };
}
