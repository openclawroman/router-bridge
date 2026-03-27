import { execSync } from "child_process";

export interface DependencyStatus {
  name: string;
  installed: boolean;
  version?: string;
  path?: string;
  installHint?: string;
}

const DEPENDENCY_HINTS: Record<string, string> = {
  codex: "npm install -g @openai/codex",
  claude: "npm install -g @anthropic-ai/claude-code",
  python3: "Install Python 3.10+ from https://python.org or via your package manager",
};

/**
 * Check if a single CLI dependency is available on the system.
 */
export function checkDependency(name: string): DependencyStatus {
  // Try `command -v` first (POSIX), fall back to `which`
  let cmdPath: string | undefined;
  try {
    cmdPath = execSync(`command -v ${name} 2>/dev/null || which ${name} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return {
      name,
      installed: false,
      installHint: DEPENDENCY_HINTS[name],
    };
  }

  if (!cmdPath) {
    return {
      name,
      installed: false,
      installHint: DEPENDENCY_HINTS[name],
    };
  }

  // Try to get version
  let version: string | undefined;
  try {
    const output = execSync(`${name} --version 2>&1`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Extract a semver-like version string
    const match = output.match(/(\d+\.\d+\.\d+[a-zA-Z0-9.-]*)/);
    version = match ? match[1] : output.split("\n")[0].substring(0, 80);
  } catch {
    // version unavailable — not critical
  }

  return {
    name,
    installed: true,
    version,
    path: cmdPath,
  };
}

/**
 * Check all required dependencies for the router.
 */
export function checkAllDependencies(): DependencyStatus[] {
  return [
    checkDependency("codex"),
    checkDependency("claude"),
    checkDependency("python3"),
  ];
}

/**
 * Format dependency statuses into a readable report string.
 */
export function formatDependencyReport(statuses: DependencyStatus[]): string {
  return statuses
    .map((s) => {
      if (s.installed) {
        const ver = s.version ? ` v${s.version}` : "";
        const loc = s.path ? ` (${s.path})` : "";
        return `  ✅ ${s.name}${ver}${loc}`;
      }
      const hint = s.installHint ? `\n     Install: ${s.installHint}` : "";
      return `  ❌ ${s.name} — not found${hint}`;
    })
    .join("\n");
}

/**
 * Quick check — returns false if any required dependency is missing.
 */
export function ensureDependencies(): boolean {
  return checkAllDependencies().every((d) => d.installed);
}

/**
 * Get just the missing dependencies.
 */
export function getMissingDependencies(): DependencyStatus[] {
  return checkAllDependencies().filter((d) => !d.installed);
}
