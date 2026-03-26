import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { PluginConfig } from "./types";

export interface Snapshot {
  id: string;
  timestamp: string;
  config: PluginConfig;
  statePath: string;
  stateContents: string | null;
  routerConfigContents: string | null;
}

/**
 * Create a snapshot of current bridge config + state + router config.
 */
export function takeSnapshot(config: PluginConfig): Snapshot {
  const id = `snap-${Date.now()}`;
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT
    || path.join(process.env.HOME || "/root", ".openclaw", "router");
  const statePath = path.join(routerRoot, "runtime", "bridge", ".router-state.json");
  const configPath = config.routerConfigPath.replace(/^~/, process.env.HOME || "/root");

  let stateContents: string | null = null;
  if (fs.existsSync(statePath)) {
    stateContents = fs.readFileSync(statePath, "utf-8");
  }

  let routerConfigContents: string | null = null;
  if (fs.existsSync(configPath)) {
    routerConfigContents = fs.readFileSync(configPath, "utf-8");
  }

  return {
    id,
    timestamp: new Date().toISOString(),
    config: { ...config },
    statePath,
    stateContents,
    routerConfigContents,
  };
}

/**
 * Restore a snapshot — writes back state + config files.
 */
export function restoreSnapshot(snapshot: Snapshot): string[] {
  const restored: string[] = [];

  // Restore state
  if (snapshot.stateContents) {
    const dir = path.dirname(snapshot.statePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(snapshot.statePath, snapshot.stateContents);
    restored.push("state");
  }

  // Restore config
  const configPath = snapshot.config.routerConfigPath.replace(/^~/, process.env.HOME || "/root");
  if (snapshot.routerConfigContents) {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    // Backup current before restore
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + `.pre-restore.${Date.now()}`);
    }
    fs.writeFileSync(configPath, snapshot.routerConfigContents);
    restored.push("config");
  }

  return restored;
}

/**
 * Format a snapshot for display.
 */
export function formatSnapshot(snapshot: Snapshot): string {
  return [
    `📸 Snapshot ${snapshot.id}`,
    `  Time: ${snapshot.timestamp}`,
    `  State: ${snapshot.stateContents ? "captured" : "none"}`,
    `  Router config: ${snapshot.routerConfigContents ? "captured" : "none"}`,
  ].join("\n");
}
