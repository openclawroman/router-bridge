import { takeSnapshot, restoreSnapshot, formatSnapshot, Snapshot } from "./snapshot";
import { checkSecrets, loadEnvFile } from "./secrets";
import { ExecutionBackend, ScopeType, RolloutLevel, ShadowMode, PluginConfig, DEFAULT_CONFIG } from "./types";
import { ExecutionBackendStore } from "./store";
import { createAdapter } from "./adapters/factory";
import type { HealthResult } from "./adapters/base";
import { runDoctor } from "./doctor";
import { shouldRoute, describeRolloutLevel } from "./rollout";
import * as fs from "fs";
import * as path from "path";

const store = new ExecutionBackendStore();

function resolveScope(ctx: any, config: PluginConfig): { scopeType: ScopeType; scopeId: string; threadId: string | null; sessionId: string | null } {
  // Thread-scoped by default (matches OpenClaw convention)
  const scopeType = config.scopeMode === ScopeType.Global ? ScopeType.Global
    : config.scopeMode === ScopeType.Session ? ScopeType.Session
    : ScopeType.Thread;

  // Use channel context for scope ID when available
  const threadId = ctx.threadId || null;
  const sessionId = ctx.sessionKey || null;

  let scopeId: string;
  if (scopeType === ScopeType.Thread) {
    scopeId = threadId || sessionId || "default";
  } else if (scopeType === ScopeType.Session) {
    scopeId = sessionId || "default";
  } else {
    scopeId = "default";
  }

  return { scopeType, scopeId, threadId, sessionId };
}

export { resolveScope, store };

export function handleRouterOn(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const { scopeType, scopeId, threadId, sessionId } = resolveScope(ctx, config);
  store.set(scopeType, scopeId, ExecutionBackend.RouterBridge, threadId, sessionId);
  return {
    text: [
      "✅ Router backend enabled for this scope.",
      `Scope: ${scopeType}:${scopeId}`,
      `Backend: ${ExecutionBackend.RouterBridge}`,
    ].join("\n"),
  };
}

export function handleRouterOff(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const { scopeType, scopeId } = resolveScope(ctx, config);
  store.set(scopeType, scopeId, ExecutionBackend.Native);
  return {
    text: [
      "✅ Router backend disabled — using native.",
      `Scope: ${scopeType}:${scopeId}`,
      `Backend: ${ExecutionBackend.Native}`,
    ].join("\n"),
  };
}

export async function handleRouterStatus(ctx: any, config: PluginConfig = DEFAULT_CONFIG): Promise<{ text: string }> {
  const { scopeType, scopeId, threadId, sessionId } = resolveScope(ctx, config);
  const effective = store.getEffective(scopeType, scopeId, threadId || undefined, sessionId || undefined);

  // Health check — delegates through adapter (single source of truth)
  const adapter = createAdapter(config);
  const health = await adapter.health();
  const healthIcon = health.healthy ? "✅ healthy" : "❌ unavailable";
  const healthLine = `Health: ${healthIcon} (${health.latencyMs}ms)`;
  const healthOutput = `  Output: ${health.output}`;

  // Last error display
  const lastError = adapter.getLastHealthError?.() ?? null;
  const errorLine = lastError ? `\n⚠️ Last error: ${lastError}` : "";

  // Backend status
  const backendStatus = effective.executionBackend === ExecutionBackend.RouterBridge
    ? (health.healthy ? "active" : "unavailable")
    : "—";
  const backendLine = effective.executionBackend === ExecutionBackend.RouterBridge
    ? `Backend status: ${backendStatus}`
    : null;

  // Fallback policy
  const fallbackPolicy = config.fallbackToNativeOnError
    ? "native (auto-fallback on error)"
    : "none (errors will propagate)";

  const lines = [
    "📊 **Router Bridge Status**",
    `Backend: \`${effective.executionBackend}\``,
    `Scope: ${effective.scopeType}:${effective.scopeId}`,
    `Thread: ${effective.threadId ?? "—"}`,
    `Session: ${effective.sessionId ?? "—"}`,
    "",
    healthLine,
    healthOutput,
    errorLine,
    "",
    "**Config:**",
    `Scope mode: ${config.scopeMode}`,
    `Router command: \`${config.routerCommand}\``,
    `Fallback on error: ${config.fallbackToNativeOnError ? "yes" : "no"}`,
    `Health cache TTL: ${config.healthCacheTtlMs}ms`,
    "",
    `Fallback policy: ${fallbackPolicy}`,
  ];

  if (backendLine) lines.splice(6, 0, backendLine);

  if (effective.executionBackend === ExecutionBackend.RouterAcp) {
    lines.push(`ACP target: ${effective.targetHarnessId ?? "—"}`);
  }

  // Doctor checks
  const doctorChecks = runDoctor(config);
  const allPassed = doctorChecks.every(c => c.passed);
  lines.push("");
  lines.push(`Doctor: ${allPassed ? "✅ All checks passed" : "⚠️ Issues found"}`);
  for (const check of doctorChecks) {
    lines.push(`  ${check.passed ? "✅" : "❌"} ${check.name}: ${check.message}`);
    if (!check.passed && check.details) {
      lines.push(`     → ${check.details}`);
    }
  }

  return { text: lines.join("\n") };
}

export function handleRouterInitConfig(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  // Expand ~ in path
  const configPath = config.routerConfigPath.replace(/^~/, process.env.HOME || "/root");
  const configDir = path.dirname(configPath);

  // Ensure config directory exists
  fs.mkdirSync(configDir, { recursive: true });

  if (fs.existsSync(configPath)) {
    return { text: `⚠️ Config already exists at ${configPath}. Use 'migrate' to update it.` };
  }

  // Generate default config
  const defaultConfig = {
    router_config_version: 1,
    provider: {
      openrouter: { api_key_env: "OPENROUTER_API_KEY" },
      anthropic: { api_key_env: "ANTHROPIC_API_KEY" },
    },
    routing: {
      default_executor: "openrouter",
      rules: [
        { task_class: "code_generation", executor: "codex_cli" },
        { task_class: "code_review", executor: "claude_code" },
        { task_class: "planning", executor: "openrouter" },
        { task_class: "general", executor: "openrouter" },
      ],
    },
    timeout: { default_ms: 120000, max_ms: 300000 },
  };

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n");
  return { text: `✅ Config created at ${configPath}` };
}

export function handleRouterMigrateConfig(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const configPath = config.routerConfigPath.replace(/^~/, process.env.HOME || "/root");

  if (!fs.existsSync(configPath)) {
    return { text: `❌ No config found at ${configPath}. Use 'init-config' first.` };
  }

  // Backup
  const backup = configPath + `.backup.${Date.now()}`;
  fs.copyFileSync(configPath, backup);

  // Read existing
  const existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Merge with defaults (preserving user overrides)
  const migrated = {
    router_config_version: existing.router_config_version ?? 1,
    ...existing,
    _migrated_from: backup,
    _migrated_at: new Date().toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(migrated, null, 2) + "\n");
  return { text: `✅ Config migrated. Backup at ${backup}` };
}

export function handleRouterRollout(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const levelArg = (args || "").trim().toLowerCase();
  
  const levels: Record<string, RolloutLevel> = {
    "native": RolloutLevel.Native,
    "health-check": RolloutLevel.HealthCheck,
    "health": RolloutLevel.HealthCheck,
    "thread": RolloutLevel.Thread,
    "session": RolloutLevel.Session,
    "global": RolloutLevel.Global,
  };

  if (!levelArg) {
    return {
      text: [
        `Rollout level: ${describeRolloutLevel(config.rolloutLevel)}`,
        `Shadow mode: ${config.shadowMode}`,
        "",
        "Available levels:",
        "  native       — Level 0: Fully native (router inactive)",
        "  health-check — Level 1: Router health checks only",
        "  thread       — Level 2: Thread-level opt-in",
        "  session      — Level 3: Session-level opt-in",
        "  global       — Level 4: Global default",
        "",
        "Usage: /router rollout <level>",
      ].join("\n"),
    };
  }

  if (!levels[levelArg]) {
    return { text: `❌ Unknown rollout level: ${levelArg}\nAvailable: native, health-check, thread, session, global` };
  }

  const level = levels[levelArg];
  return {
    text: `⚠️ Rollout level change requested: ${describeRolloutLevel(level)}\n` +
      `To apply, update your plugin config:\n` +
      `  "rolloutLevel": "${level}"`,
  };
}

export function handleRouterShadow(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const modeArg = (args || "").trim().toLowerCase();
  
  if (!modeArg) {
    return {
      text: [
        `Shadow mode: ${config.shadowMode}`,
        "",
        "  off    — No shadow runs",
        "  observe — Run router in parallel, log results, don't affect output",
        "",
        "Usage: /router shadow <mode>",
      ].join("\n"),
    };
  }

  if (modeArg !== "off" && modeArg !== "observe") {
    return { text: `❌ Unknown shadow mode: ${modeArg}\nAvailable: off, observe` };
  }

  return {
    text: `⚠️ Shadow mode change requested: ${modeArg}\n` +
      `To apply, update your plugin config:\n` +
      `  "shadowMode": "${modeArg}"`,
  };
}

const snapshots: Map<string, Snapshot> = new Map();

export { snapshots };

export function handleRouterSnapshot(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const snap = takeSnapshot(config);
  snapshots.set(snap.id, snap);
  return { text: formatSnapshot(snap) };
}

export function handleRouterRestore(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const id = (args || "").trim();
  if (!id) {
    const ids = Array.from(snapshots.keys());
    return { text: ids.length > 0 ? `Available snapshots:\n${ids.join("\n")}` : "No snapshots available." };
  }
  const snap = snapshots.get(id);
  if (!snap) {
    return { text: `❌ Snapshot not found: ${id}` };
  }
  const restored = restoreSnapshot(snap);
  return { text: `✅ Restored: ${restored.join(", ")} (from ${snap.id})` };
}

export async function handleRouterCommand(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): Promise<{ text: string }> {
  const sub = (args || "").trim().toLowerCase();

  // Check for snapshot/restore subcommands with possible args
  if (sub === "snapshot") {
    return handleRouterSnapshot(ctx, config);
  }
  if (sub === "restore" || sub.startsWith("restore ")) {
    const restoreArgs = sub === "restore" ? "" : args!.trim().slice("restore ".length);
    return handleRouterRestore(restoreArgs, ctx, config);
  }
  if (sub === "rollout" || sub.startsWith("rollout ")) {
    const rolloutArgs = sub === "rollout" ? "" : args!.trim().slice("rollout ".length);
    return handleRouterRollout(rolloutArgs || undefined, ctx, config);
  }
  if (sub === "shadow" || sub.startsWith("shadow ")) {
    const shadowArgs = sub === "shadow" ? "" : args!.trim().slice("shadow ".length);
    return handleRouterShadow(shadowArgs || undefined, ctx, config);
  }
  if (sub === "init-config") {
    return handleRouterInitConfig(ctx, config);
  }
  if (sub === "migrate-config") {
    return handleRouterMigrateConfig(ctx, config);
  }

  switch (sub) {
    case "on":
      return handleRouterOn(ctx, config);
    case "off":
      return handleRouterOff(ctx, config);
    case "status":
    case "":
      return handleRouterStatus(ctx, config);
    default:
      return { text: `❌ Unknown subcommand: ${sub}\nUsage: /router [on|off|status|init-config|migrate-config|rollout|shadow|snapshot|restore]` };
  }
}
