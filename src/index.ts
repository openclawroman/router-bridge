import { ensureRuntimeDirectories, validateStateIntegrity, repairStateFile } from "./store";
import { handleRouterCommand, handleRouterIntent } from "./commands";
import { matchRouterIntent } from "./skill";
import type { PluginConfig } from "./types";
import { checkVersionCompatibility, formatVersionInfo } from "./src/versions";
import { validateConfig } from "./src/config-validate";

export { ensureRuntimeDirectories, validateStateIntegrity, repairStateFile } from "./store";
export { handleRouterCommand, handleRouterIntent, resolveScope, store } from "./commands";
export { matchRouterIntent } from "./skill";
export { createAdapter } from "./adapters/factory";
export type { TaskEnvelope, ExecuteResult, HealthResult } from "./adapters/base";
export { checkDisableOrReprobe, markRecovered, getRecoveryState, formatRecoveryState, resetRecoveryState } from "./recovery";

/**
 * Build a TaskEnvelope with continuity metadata from execution context.
 */
export function buildTaskEnvelope(opts: {
  task: string;
  taskId: string;
  scopeId: string;
  threadId?: string | null;
  sessionId?: string | null;
  taskMeta?: Record<string, any>;
  taskClass?: string;
  ctx?: any;
}) {
  const ctx = opts.ctx || {};
  return {
    task: opts.task,
    taskId: opts.taskId,
    scopeId: opts.scopeId,
    threadId: opts.threadId,
    sessionId: opts.sessionId,
    taskMeta: opts.taskMeta,
    taskClass: opts.taskClass,
    prompt: opts.task,
    cwd: ctx.cwd || process.cwd(),
    recentContext: ctx.recentMessages?.slice(-3)?.map((m: any) => m.text || m).join("\n") || null,
    repoBranch: ctx.gitBranch || null,
  };
}

/**
 * Register the router-bridge plugin.
 *
 * Call this from your OpenClaw extension entry point:
 *   import register from "router-bridge";
 *   register(api);
 */
export default function register(api: any) {
  // Ensure directories on startup
  ensureRuntimeDirectories();

  // Version compatibility check
  const versionInfo = checkVersionCompatibility();
  if (!versionInfo.compatible) {
    api.logger?.warn(`router-bridge: ${versionInfo.issues.join("; ")}`);
  }

  // Config validation
  const configValidation = validateConfig(api.config || {} as any);
  if (!configValidation.valid) {
    api.logger?.error(`router-bridge config errors: ${configValidation.errors.join("; ")}`);
  }
  for (const w of configValidation.warnings) {
    api.logger?.warn(`router-bridge config: ${w}`);
  }

  // Validate state integrity
  const { valid, issues } = validateStateIntegrity();
  if (!valid) {
    api.logger?.warn(`router-bridge: state integrity issues detected: ${issues.join(", ")}`);
    const repairResult = repairStateFile();
    api.logger?.info(`router-bridge: ${repairResult}`);
  }

  // ... rest of register function
  return {
    handleRouterCommand,
    handleRouterIntent,
    matchRouterIntent,
    buildTaskEnvelope,
  };
}
