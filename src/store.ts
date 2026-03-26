import { ExecutionBackend, ScopeType, RouterState } from "./types";
import * as fs from "fs";
import * as path from "path";

function getStateFilePath(): string {
  return path.join(
    process.env.OPENCLAW_WORKSPACE || process.env.HOME || "/tmp",
    ".openclaw/workspace/extensions/router-bridge/.router-state.json"
  );
}

function loadAll(): Record<string, RouterState> {
  try {
    return JSON.parse(fs.readFileSync(getStateFilePath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveAll(states: Record<string, RouterState>): void {
  const dir = path.dirname(getStateFilePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStateFilePath(), JSON.stringify(states, null, 2));
}

function scopeKey(scopeType: ScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

export class ExecutionBackendStore {
  get(scopeType: ScopeType, scopeId: string): RouterState | null {
    const states = loadAll();
    return states[scopeKey(scopeType, scopeId)] || null;
  }

  set(scopeType: ScopeType, scopeId: string, backend: ExecutionBackend): RouterState {
    const states = loadAll();
    const key = scopeKey(scopeType, scopeId);
    const existing = states[key];
    const state: RouterState = {
      executionBackend: backend,
      scopeType,
      scopeId,
      threadId: existing?.threadId ?? null,
      sessionId: existing?.sessionId ?? null,
      targetHarnessId: existing?.targetHarnessId ?? null,
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
