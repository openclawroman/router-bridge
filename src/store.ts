import { ExecutionBackend, ScopeType, RouterState } from "./types";
import * as fs from "fs";
import * as path from "path";

function getStateFilePath(): string {
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT
    || path.join(process.env.HOME || "/root", ".openclaw", "router");
  return path.join(routerRoot, "runtime", "bridge", "state.json");
}

export function ensureRuntimeDirectories(): void {
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT
    || path.join(process.env.HOME || "/root", ".openclaw", "router");
  const bridgeDir = path.join(routerRoot, "runtime", "bridge");
  const routerDir = path.join(routerRoot, "runtime", "router");
  fs.mkdirSync(bridgeDir, { recursive: true });
  fs.mkdirSync(routerDir, { recursive: true });
}

export function validateStateIntegrity(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const filePath = getStateFilePath();

  try {
    if (!fs.existsSync(filePath)) {
      return { valid: true, issues: ["No state file (fresh install)"] };
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    // Validate each state entry
    for (const [key, state] of Object.entries(parsed)) {
      if (!state || typeof state !== "object") {
        issues.push(`Invalid state entry for key: ${key}`);
        continue;
      }
      const s = state as any;
      if (!s.executionBackend) issues.push(`Missing executionBackend in ${key}`);
      if (!s.scopeType) issues.push(`Missing scopeType in ${key}`);
      if (!s.scopeId) issues.push(`Missing scopeId in ${key}`);
    }

    return { valid: issues.length === 0, issues };
  } catch (err: any) {
    return { valid: false, issues: [`Corrupt state file: ${err.message}`] };
  }
}

export function repairStateFile(): string {
  const filePath = getStateFilePath();

  if (!fs.existsSync(filePath)) {
    return "No state file to repair";
  }

  const backup = filePath + `.backup.${Date.now()}`;
  fs.copyFileSync(filePath, backup);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const clean: Record<string, RouterState> = {};

    for (const [key, state] of Object.entries(parsed)) {
      const s = state as any;
      if (s.executionBackend && s.scopeType && s.scopeId) {
        clean[key] = s as RouterState;
      }
    }

    saveAll(clean);
    return `Repaired. Invalid entries removed. Backup at ${backup}`;
  } catch {
    // Full corruption — reset
    saveAll({});
    return `State file corrupted. Reset to empty. Backup at ${backup}`;
  }
}

function loadAll(): Record<string, RouterState> {
  const filePath = getStateFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    if (raw.trim() === "") return {};
    return JSON.parse(raw);
  } catch (err: any) {
    if (err.code === "ENOENT") return {};
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

function saveAll(states: Record<string, RouterState>): void {
  const filePath = getStateFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(states, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function scopeKey(scopeType: ScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

export class ExecutionBackendStore {
  get(scopeType: ScopeType, scopeId: string): RouterState | null {
    const states = loadAll();
    return states[scopeKey(scopeType, scopeId)] || null;
  }

  set(scopeType: ScopeType, scopeId: string, backend: ExecutionBackend, threadId?: string | null, sessionId?: string | null, targetHarnessId?: string | null): RouterState {
    const states = loadAll();
    const key = scopeKey(scopeType, scopeId);
    const existing = states[key];
    const state: RouterState = {
      executionBackend: backend,
      scopeType,
      scopeId,
      threadId: threadId !== undefined ? threadId : (existing?.threadId ?? null),
      sessionId: sessionId !== undefined ? sessionId : (existing?.sessionId ?? null),
      targetHarnessId: targetHarnessId !== undefined ? targetHarnessId : (existing?.targetHarnessId ?? null),
    };
    states[key] = state;
    saveAll(states);
    return state;
  }

  clear(scopeType: ScopeType, scopeId: string): boolean {
    const states = loadAll();
    const key = scopeKey(scopeType, scopeId);
    if (!states[key]) return false;
    delete states[key];
    saveAll(states);
    return true;
  }

  status(scopeType: ScopeType, scopeId: string): string {
    const state = this.get(scopeType, scopeId);
    if (!state) return "No override set (using default).";
    return `Backend: ${state.executionBackend}\nScope: ${state.scopeType}:${state.scopeId}\nThread: ${state.threadId ?? "—"}\nSession: ${state.sessionId ?? "—"}`;
  }

  getEffective(scopeType: ScopeType, scopeId: string, threadId?: string, sessionId?: string): RouterState {
    if (threadId) {
      const threadState = this.get(ScopeType.Thread, threadId);
      if (threadState) return threadState;
    }
    if (sessionId) {
      const sessionState = this.get(ScopeType.Session, sessionId);
      if (sessionState) return sessionState;
    }
    // Check the requested scope (e.g., thread:agent:main:main)
    const scopeState = this.get(scopeType, scopeId);
    if (scopeState) return scopeState;
    // Fallback to default within the same scope type (e.g., thread:default)
    if (scopeId !== "default") {
      const defaultScopeState = this.get(scopeType, "default");
      if (defaultScopeState) return defaultScopeState;
    }
    const globalState = this.get(ScopeType.Global, "default");
    if (globalState) return globalState;
    return {
      executionBackend: ExecutionBackend.Native,
      scopeType: ScopeType.Global,
      scopeId: "default",
      threadId: null,
      sessionId: null,
      targetHarnessId: null,
    };
  }
}
