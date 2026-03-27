import * as fs from "fs";
import * as path from "path";

/** Expected openclaw-router version (must match) */
export const REQUIRED_ROUTER_VERSION = "0.6.0";

export interface VersionInfo {
  pluginVersion: string;
  requiredRouterVersion: string;
  installedRouterVersion: string | null;
  compatible: boolean;
  issues: string[];
}

/**
 * Read the installed openclaw-router version from VERSION file or config.
 */
function getInstalledRouterVersion(): string | null {
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT
    || path.join(process.env.HOME || "/root", ".openclaw", "router");

  // Try VERSION file first
  const versionFile = path.join(routerRoot, "VERSION");
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, "utf-8").trim();
  }

  // Try installed config
  const configDir = path.join(routerRoot, "config");
  if (fs.existsSync(path.join(configDir, "version"))) {
    return fs.readFileSync(path.join(configDir, "version"), "utf-8").trim();
  }

  return null;
}

/**
 * Get the plugin version from package.json or VERSION file.
 */
export function getPluginVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Check version compatibility between plugin and router.
 */
export function checkVersionCompatibility(): VersionInfo {
  const issues: string[] = [];
  const installed = getInstalledRouterVersion();

  if (!installed) {
    issues.push("Cannot determine installed router version");
  } else if (installed !== REQUIRED_ROUTER_VERSION) {
    issues.push(`Version mismatch: plugin requires router v${REQUIRED_ROUTER_VERSION}, found v${installed}`);
  }

  return {
    pluginVersion: getPluginVersion(),
    requiredRouterVersion: REQUIRED_ROUTER_VERSION,
    installedRouterVersion: installed,
    compatible: issues.length === 0,
    issues,
  };
}

/**
 * Format version info for display.
 */
export function formatVersionInfo(info: VersionInfo): string {
  const lines: string[] = [
    `Plugin: v${info.pluginVersion}`,
    `Router: v${info.installedRouterVersion || "unknown"}`,
    `Required: v${info.requiredRouterVersion}`,
    info.compatible ? "✅ Compatible" : "❌ Incompatible",
  ];
  for (const issue of info.issues) {
    lines.push(`  → ${issue}`);
  }
  return lines.join("\n");
}
