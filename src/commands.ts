import { takeSnapshot, restoreSnapshot, formatSnapshot, Snapshot } from "./snapshot";
import { checkSecrets, loadEnvFile, checkProviderAuth, hasAnyProviderAuth } from "./secrets";
import { ExecutionBackend, ScopeType, RolloutLevel, ShadowMode, PluginConfig, DEFAULT_CONFIG } from "./types";
import { ExecutionBackendStore } from "./store";
import { createAdapter } from "./adapters/factory";
import type { HealthResult } from "./adapters/base";
import { runDoctor } from "./doctor";
import { getMetrics, getMetricsSummary } from "./metrics";
import { checkAutoDegrade } from "./safety";
import { formatRecoveryState } from "./recovery";
import { shouldRoute, describeRolloutLevel } from "./rollout";
import { checkVersionCompatibility } from "./versions";
import { validateConfig } from "./config-validate";
import { checkAllDependencies, formatDependencyReport } from "./dependencies";
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
  // Check dependencies before enabling
  const deps = checkAllDependencies();
  const missing = deps.filter(d => !d.installed);
  if (missing.length > 0) {
    return {
      text: `⚠️ Missing dependencies:\n${formatDependencyReport(missing)}\n\nInstall them before enabling router mode.`,
    };
  }

  // Check provider auth — warn but don't block if some providers are configured
  const providers = checkProviderAuth();
  const hasAuth = hasAnyProviderAuth();
  if (!hasAuth) {
    return {
      text: "⚠️ No provider auth configured. Set at least one:\n" +
        providers.map(p => {
          const hint = p.keyEnv ? `  • ${p.provider}: set ${p.keyEnv} env var` : `  • ${p.provider}: configure CLI auth`;
          return hint;
        }).join("\n") +
        "\n\nCannot enable router mode without provider auth.",
    };
  }

  // Warn about unconfigured providers (non-blocking)
  const unconfigured = providers.filter(p => !p.configured);
  const configured = providers.filter(p => p.configured).map(p => p.provider);

  const { scopeType, scopeId, threadId, sessionId } = resolveScope(ctx, config);
  store.set(scopeType, scopeId, ExecutionBackend.RouterBridge, threadId, sessionId);

  const lines = [
    "✅ Router backend enabled for this scope.",
    `Scope: ${scopeType}:${scopeId}`,
    `Backend: ${ExecutionBackend.RouterBridge}`,
    `Auth: ${configured.join(", ")}`,
  ];

  if (unconfigured.length > 0) {
    lines.push(`⚠️ No auth for: ${unconfigured.map(p => p.provider).join(", ")}`);
  }

  return { text: lines.join("\n") };
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

  // Use effective backend for health check, not global config
  const effectiveBackend = effective?.executionBackend || config.backendMode;

  // Health check — delegates through adapter (single source of truth)
  const adapter = createAdapter(config, effectiveBackend);
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
  ];

  if (backendLine) lines.push(backendLine);

  lines.push(
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
  );

  if (effective.executionBackend === ExecutionBackend.RouterAcp) {
    lines.push(`ACP target: ${effective.targetHarnessId ?? "—"}`);
  }

  // ── Rollout / Shadow (from rollout module) ──────────────────────
  try {
    const { describeRolloutLevel } = require("./rollout");
    lines.push("");
    lines.push("**Rollout:**");
    lines.push(`Level: ${describeRolloutLevel(config.rolloutLevel)}`);
    lines.push(`Shadow: ${config.shadowMode}`);
  } catch {
    lines.push("");
    lines.push(`Rollout level: ${describeRolloutLevel(config.rolloutLevel)}`);
    lines.push(`Shadow mode: ${config.shadowMode}`);
  }

  // ── Runtime info ────────────────────────────────────────────────
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT || path.join(process.env.HOME || "/root", ".openclaw", "router");
  const runtimeDir = path.join(routerRoot, "runtime");
  const runtimeExists = fs.existsSync(runtimeDir);

  // Provider availability (from doctor secrets check)
  const allDoctorChecks = runDoctor(config);
  const secretsCheck = allDoctorChecks.find(c => c.name === "secrets_present");
  const providerStatus = secretsCheck
    ? (secretsCheck.passed ? "✅ Available" : `⚠️ ${secretsCheck.message}`)
    : "❓ Unknown";

  lines.push("");
  lines.push("**Runtime:**");
  lines.push(`Install root: \`${routerRoot}\``);
  lines.push(`Runtime dir: ${runtimeExists ? "✅ exists" : "❌ missing"}`);
  lines.push(`Provider secrets: ${providerStatus}`);

  // ── Version info ────────────────────────────────────────────────
  const versionInfo = checkVersionCompatibility();
  lines.push("");
  lines.push("**Version:**");
  lines.push(`Plugin: v${versionInfo.pluginVersion}`);
  lines.push(`Router: v${versionInfo.installedRouterVersion || "unknown"}`);
  if (!versionInfo.compatible) {
    for (const issue of versionInfo.issues) {
      lines.push(`⚠️ ${issue}`);
    }
  }

  // ── Config validation ───────────────────────────────────────────
  const configValidation = validateConfig(config);
  if (!configValidation.valid || configValidation.warnings.length > 0) {
    lines.push("");
    lines.push("**Config Validation:**");
    for (const e of configValidation.errors) lines.push(`❌ ${e}`);
    for (const w of configValidation.warnings) lines.push(`⚠️ ${w}`);
  }

  // ── Metrics (graceful if module not available) ──────────────────
  try {
    const { getMetricsSummary, getMetrics } = require("./metrics");
    const metrics = getMetrics();
    lines.push("");
    lines.push("**Metrics:**");
    lines.push(getMetricsSummary());
    if (metrics.lastSuccessAt) lines.push(`Last success: ${metrics.lastSuccessAt}`);
    if (metrics.lastFallbackAt) lines.push(`Last fallback: ${metrics.lastFallbackAt} — ${metrics.lastFallbackReason}`);
  } catch {
    // Metrics module not available — show basic fallback info from context
    const lastFallback = (ctx as any).routerFallback ? ((ctx as any).routerError || "unknown reason") : null;
    const lastSuccess = (ctx as any).routerMetadata
      ? `${(ctx as any).routerMetadata.backend} (${(ctx as any).routerMetadata.durationMs}ms)`
      : null;
    if (lastFallback) lines.push(`Last fallback: ⚠️ ${lastFallback}`);
    if (lastSuccess) lines.push(`Last success: ✅ ${lastSuccess}`);
  }

  // ── Auto-degrade (graceful if safety module not available) ──────
  try {
    const { checkAutoDegrade } = require("./safety");
    const safety = checkAutoDegrade(config);
    if (safety.shouldDegrade) {
      lines.push("");
      lines.push(`⚠️ AUTO-DEGRADED: ${safety.reason}`);
    }
  } catch {
    // Safety module not available
  }

  // ── Recovery ────────────────────────────────────────────────────
  try {
    lines.push("");
    lines.push("**Recovery:**");
    lines.push(formatRecoveryState());
  } catch {
    // Recovery module not available
  }

  // ── Security audit (graceful) ───────────────────────────────────
  try {
    const { auditSecurity } = require("./security");
    const secAudit = auditSecurity();
    lines.push("");
    lines.push("**Security:**");
    if (secAudit.passed) {
      lines.push("✅ All security checks passed");
    } else {
      lines.push(`⚠️ ${secAudit.issues.length} issue(s):`);
      for (const issue of secAudit.issues) {
        lines.push(`  • ${issue}`);
      }
    }
  } catch {
    // Security module not available
  }

  // ── Doctor checks ───────────────────────────────────────────────
  // ── Metrics ─────────────────────────────────────────────────────
  try {
    const metrics = getMetrics();
    lines.push("");
    lines.push("**Metrics:**");
    lines.push(getMetricsSummary());
    if (metrics.lastSuccessAt) lines.push(`Last success: ${metrics.lastSuccessAt}`);
    if (metrics.lastFallbackAt) lines.push(`Last fallback: ${metrics.lastFallbackAt} — ${metrics.lastFallbackReason}`);

    const safety = checkAutoDegrade(config);
    if (safety.shouldDegrade) {
      lines.push("");
      lines.push(`⚠️ AUTO-DEGRADED: ${safety.reason}`);
    }
  } catch {
    // Metrics module not available
  }

  const allPassed = allDoctorChecks.every(c => c.passed);
  lines.push("");
  lines.push(`Doctor: ${allPassed ? "✅ All checks passed" : "⚠️ Issues found"}`);
  for (const check of allDoctorChecks) {
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
        { task_class: "implementation", executor: "codex_cli" },
        { task_class: "code_review", executor: "claude_code" },
        { task_class: "planner", executor: "openrouter" },
        { task_class: "implementation", executor: "openrouter" },
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
    "native": RolloutLevel.Native, "health-check": RolloutLevel.HealthCheck,
    "health": RolloutLevel.HealthCheck, "thread": RolloutLevel.Thread,
    "session": RolloutLevel.Session, "global": RolloutLevel.Global,
  };
  if (!levelArg) {
    return { text: [
      `Rollout level: ${describeRolloutLevel(config.rolloutLevel)}`,
      `Shadow mode: ${config.shadowMode}`, "",
      "Available levels:",
      "  native       — Level 0: Fully native (router inactive)",
      "  health-check — Level 1: Router health checks only",
      "  thread       — Level 2: Thread-level opt-in",
      "  session      — Level 3: Session-level opt-in",
      "  global       — Level 4: Global default", "",
      "Usage: /router rollout <level>",
    ].join("\n") };
  }
  if (!levels[levelArg]) {
    return { text: `❌ Unknown rollout level: ${levelArg}\nAvailable: native, health-check, thread, session, global` };
  }
  const level = levels[levelArg];
  return { text: `⚠️ Rollout level change requested: ${describeRolloutLevel(level)}\nTo apply, update your plugin config:\n  "rolloutLevel": "${level}"` };
}

export function handleRouterShadow(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const modeArg = (args || "").trim().toLowerCase();
  if (!modeArg) {
    return { text: [
      `Shadow mode: ${config.shadowMode}`, "",
      "  off    — No shadow runs",
      "  observe — Run router in parallel, log results, don't affect output", "",
      "Usage: /router shadow <mode>",
    ].join("\n") };
  }
  if (modeArg !== "off" && modeArg !== "observe") {
    return { text: `❌ Unknown shadow mode: ${modeArg}\nAvailable: off, observe` };
  }
  return { text: `⚠️ Shadow mode change requested: ${modeArg}\nTo apply, update your plugin config:\n  "shadowMode": "${modeArg}"` };
}

export function handleRouterSnapshot(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  try {
    const { takeSnapshot, formatSnapshot } = require("./snapshot");
    const snap = takeSnapshot(config);
    return { text: formatSnapshot(snap) };
  } catch {
    return { text: "❌ Snapshot module not available" };
  }
}

export function handleRouterDoctor(ctx: any, config: PluginConfig = DEFAULT_CONFIG): { text: string } {
  const allChecks = runDoctor(config);
  const deps = checkAllDependencies();

  const lines = [
    "🩺 **Router Doctor**",
    "",
    "**Dependency Check:**",
    formatDependencyReport(deps),
    "",
  ];

  const allPassed = allChecks.every(c => c.passed);
  const allDepsInstalled = deps.every(d => d.installed);

  lines.push("**System Checks:**");
  for (const check of allChecks) {
    lines.push(`  ${check.passed ? "✅" : "❌"} ${check.name}: ${check.message}`);
    if (!check.passed && check.details) {
      lines.push(`     → ${check.details}`);
    }
  }

  lines.push("");
  if (allPassed && allDepsInstalled) {
    lines.push("✅ All checks passed — router is ready.");
  } else {
    const issues: string[] = [];
    if (!allDepsInstalled) issues.push(`${deps.filter(d => !d.installed).length} missing dependency(ies)`);
    if (!allPassed) issues.push(`${allChecks.filter(c => !c.passed).length} system check(s) failed`);
    lines.push(`⚠️ Issues found: ${issues.join(", ")}`);
  }

  return { text: lines.join("\n") };
}

export async function handleRouterCommand(args: string | undefined, ctx: any, config: PluginConfig = DEFAULT_CONFIG): Promise<{ text: string }> {
  const sub = (args || "").trim().toLowerCase();
  switch (sub) {
    case "on":
      return handleRouterOn(ctx, config);
    case "off":
      return handleRouterOff(ctx, config);
    case "init-config":
      return handleRouterInitConfig(ctx, config);
    case "migrate-config":
      return handleRouterMigrateConfig(ctx, config);
    case "rollout":
      return handleRouterRollout(undefined, ctx, config);
    case "shadow":
      return handleRouterShadow(undefined, ctx, config);
    case "status":
    case "":
      return handleRouterStatus(ctx, config);
    case "snapshot":
      return handleRouterSnapshot(ctx, config);
    case "doctor":
      return handleRouterDoctor(ctx, config);
    default:
      if (sub.startsWith("rollout ")) {
        return handleRouterRollout(sub.slice("rollout ".length), ctx, config);
      }
      if (sub.startsWith("shadow ")) {
        return handleRouterShadow(sub.slice("shadow ".length), ctx, config);
      }
      return { text: `❌ Unknown subcommand: ${sub}\nUsage: /router [on|off|status|rollout|shadow|snapshot|doctor|init-config|migrate-config]` };
  }
}
