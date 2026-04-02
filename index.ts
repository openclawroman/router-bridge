import { handleRouterCommand } from "./src/commands";
import { matchRouterIntent, handleRouterIntent } from "./src/skill";
import { shouldDelegateToExecutionBackend, classifyTask } from "./src/policy";
import type { PluginConfig } from "./src/types";
import { DEFAULT_CONFIG } from "./src/types";
import { createAdapter } from "./src/adapters/factory";
import { store } from "./src/commands";
import { ExecutionBackend, ScopeType } from "./src/types";
import { extractRuntimeScope } from "./src/scope";
import { redactSecrets } from "./src/security";
import { recordSuccess, recordFallback, recordTimeout, recordHealthFailure } from "./src/metrics";
import { checkAutoDegrade } from "./src/safety";
import { markRecovered } from "./src/recovery";

const fs = require("fs");
const path = require("path");

export interface DelegationEntry {
  task_id: string;
  thread_id: string;
  session_id: string;
  timestamp: number;
  tool: string;
  backend: string;
  model: string;
  task: string;
  output: string;
  cwd?: string;
}

const MEMORY_STORE_DIR = "/Users/openclaw/src/router-bridge/state/memory";
const MEMORY_STORE_MAX_ENTRIES = 5;

function sanitizeThreadId(threadId: string): string {
  return threadId.replace(/[:/\\<>|?*"]/g, "_");
}

function resolveMemoryStoreKey(threadId?: string | null, sessionId?: string | null): string {
  return threadId || sessionId || "default";
}

function getMemoryStorePath(threadId?: string | null, sessionId?: string | null): string {
  const key = sanitizeThreadId(resolveMemoryStoreKey(threadId, sessionId));
  return path.join(MEMORY_STORE_DIR, `${key}.json`);
}

function readMemoryEntries(filePath: string): DelegationEntry[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeDelegatedResult(entry: DelegationEntry): boolean {
  try {
    fs.mkdirSync(MEMORY_STORE_DIR, { recursive: true });

    const filePath = getMemoryStorePath(entry.thread_id, entry.session_id);
    const entries = readMemoryEntries(filePath);
    entries.push(entry);
    while (entries.length > MEMORY_STORE_MAX_ENTRIES) {
      entries.shift();
    }

    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err: any) {
    console.warn?.(`[router-bridge] memory store write failed: ${err?.message || err}`);
    return false;
  }
}

export function storeDelegatedResultIfSuccessful(success: boolean, entry: DelegationEntry): boolean {
  if (!success) return false;
  return storeDelegatedResult(entry);
}

export function getDelegationMemoryFilePath(threadId?: string | null, sessionId?: string | null): string {
  return getMemoryStorePath(threadId, sessionId);
}

export default function register(api: any) {
  const getConfig = (): PluginConfig => ({
    ...DEFAULT_CONFIG,
    ...(api.config?.plugins?.entries?.["router-bridge"]?.config ?? {}),
  });

  // ── Auto-reply command ────────────────────────────────────────────
  api.registerCommand({
    name: "router",
    description: "Control router execution backend (/router on|off|status)",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      return handleRouterCommand(ctx.args, ctx, getConfig());
    },
  });

  // ── Skill handler ─────────────────────────────────────────────────
  if (api.registerSkill) {
    api.registerSkill({
      id: "router-bridge",
      match: (input: string) => {
        const m = matchRouterIntent(input);
        return m.matched ? { action: m.action, confidence: m.confidence } : null;
      },
      handler: async (ctx: any) => {
        const config = getConfig();
        return handleRouterIntent(ctx.input || ctx.args || "", ctx, config);
      },
    });
  }

  // ── Execution hook: intercept coding tasks ────────────────────────
  if (api.on) {
    api.on("before_prompt_build", async (event: any, ctx: any) => {
      const config = getConfig();

      const taskText = event.prompt || ctx.userMessage || "";
      const classification = classifyTask(taskText);
      if (!classification.isCodingTask) return;

      // Use hookCtx fields: sessionKey (thread identifier), sessionId
      const { scopeType, scopeId, threadId, sessionId } = extractRuntimeScope(ctx, config);

      const decision = await shouldDelegateToExecutionBackend(
        taskText,
        config,
        scopeId,
        scopeType,
        undefined,
        threadId,
        sessionId,
      );
      api.logger?.info?.(`[router-bridge] decision=${JSON.stringify(decision)}`);

      if (decision.delegate) {
        const adapter = createAdapter(config, decision.backend);

        if (config.fallbackToNativeOnError) {
          const safety = checkAutoDegrade(config);
          if (safety.shouldDegrade) {
            recordFallback(`auto-degraded: ${safety.reason}`);
            return; // fallback to native — no prompt mutation
          }
        }

        try {
          const health = await adapter.health();
          if (!health.healthy) {
            if (config.fallbackToNativeOnError) {
              recordHealthFailure();
              recordFallback("health_failure");
              return;
            }
          }
        } catch (err: any) {
          if (config.fallbackToNativeOnError) {
            recordHealthFailure();
            recordFallback("health_exception");
            return;
          }
        }

        try {
          const result = await adapter.execute({
            task: taskText,
            taskId: ctx.messageId || `task-${Date.now()}`,
            scopeId,
            threadId,
            sessionId,
            taskMeta: { type: classification.taskType },
            taskClass: classification.taskClass,
            prompt: taskText,
            cwd: (ctx as any).workspaceDir || process.cwd(),
            recentContext: ctx.recentMessages?.slice(-3)?.map((m: any) => m.text || m).join("\n") || null,
            repoBranch: ctx.gitBranch || null,
          });
          api.logger?.info?.(`[router-bridge] execute result=${JSON.stringify({success:result.success,error:result.error,exitCode:result.exitCode})}`);

          if (result.success) {
            const TOOL_LABELS: Record<string, string> = { "codex_cli": "Codex CLI", "claude_code": "Claude Code", "openrouter_api": "OpenRouter API" };
            const BACKEND_LABELS: Record<string, string> = { "openai_native": "OpenAI", "anthropic": "Anthropic", "openrouter": "OpenRouter" };
            const parts: string[] = [];
            if (result.tool) parts.push(TOOL_LABELS[result.tool] || result.tool);
            if (result.backend) parts.push(BACKEND_LABELS[result.backend] || result.backend);
            if (result.model) parts.push(result.model);
            if (result.durationMs) parts.push(`${(result.durationMs / 1000).toFixed(1)}s`);
            if (result.costEstimateUsd && result.costEstimateUsd > 0) parts.push(`$${result.costEstimateUsd.toFixed(4)}`);

            const footer = parts.length > 0 ? `\n\n🔧 ${parts.join(" · ")}` : "";

            // Strip any existing runner footer before appending our canonical one
            const cleanOutput = String(result.output || "").replace(/\n\n🔧[^\n]*$/, "").trimEnd();
            const routerOutput = cleanOutput + footer;
            api.logger?.info?.(`[router-bridge] delegation OK, prependContext len=${routerOutput.length}`);
            storeDelegatedResultIfSuccessful(result.success, {
              task_id: String(ctx.messageId || `task-${Date.now()}`),
              thread_id: threadId || "",
              session_id: sessionId || "",
              timestamp: Date.now(),
              tool: result.tool || "",
              backend: result.backend || "",
              model: result.model || "",
              task: taskText,
              output: String(result.output || ""),
              cwd: (ctx as any).workspaceDir || process.cwd(),
            });
            return {
              prependContext: `[Router-bridge executed this coding task via ${result.model || "codex"}]\n\n${routerOutput}`,
            };
          } else if (config.fallbackToNativeOnError) {
            recordFallback(result.output || "execution_failed");
            return; // fallback to native
          }
        } catch (err: any) {
          api.logger?.error?.(`[router-bridge] execute error: ${err?.message || err}`);
          if (config.fallbackToNativeOnError) {
            if (err.message?.includes("timed out")) {
              recordTimeout();
            }
            recordFallback(err.message || "exception");
            return; // fallback to native
          }
        }
      }
    });
  }

  // ── Delegation service ────────────────────────────────────────────
  api.registerService({
    id: "router-bridge",
    start: () => {
      api.logger?.info("router-bridge service started");
    },
    stop: () => {
      api.logger?.info("router-bridge service stopped");
    },
  });
}
