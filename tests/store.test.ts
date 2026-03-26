import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionBackendStore } from "../src/store";
import { ExecutionBackend, ScopeType } from "../src/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("ExecutionBackendStore", () => {
  let store: ExecutionBackendStore;
  const TMP_DIR = path.join(os.tmpdir(), `router-bridge-test-${process.pid}-${Date.now()}`);
  const originalEnv = process.env.OPENCLAW_WORKSPACE;

  beforeEach(() => {
    process.env.OPENCLAW_WORKSPACE = TMP_DIR;
    store = new ExecutionBackendStore();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENCLAW_WORKSPACE = originalEnv;
    } else {
      delete process.env.OPENCLAW_WORKSPACE;
    }
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  describe("get()", () => {
    it("returns null for unknown scope", () => {
      expect(store.get(ScopeType.Thread, "unknown-123")).toBeNull();
    });
  });

  describe("set()", () => {
    it("creates state, get() returns it", () => {
      const result = store.set(ScopeType.Thread, "thread-1", ExecutionBackend.RouterBridge);
      expect(result.executionBackend).toBe(ExecutionBackend.RouterBridge);
      expect(result.scopeType).toBe(ScopeType.Thread);
      expect(result.scopeId).toBe("thread-1");
      expect(result.threadId).toBeNull();
      expect(result.sessionId).toBeNull();
      expect(result.targetHarnessId).toBeNull();

      const fetched = store.get(ScopeType.Thread, "thread-1");
      expect(fetched).not.toBeNull();
      expect(fetched!.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });

    it("overwrites existing state", () => {
      store.set(ScopeType.Session, "sess-1", ExecutionBackend.Native);
      store.set(ScopeType.Session, "sess-1", ExecutionBackend.RouterAcp);

      const fetched = store.get(ScopeType.Session, "sess-1");
      expect(fetched).not.toBeNull();
      expect(fetched!.executionBackend).toBe(ExecutionBackend.RouterAcp);
    });
  });

  describe("clear()", () => {
    it("removes state, get() returns null", () => {
      store.set(ScopeType.Global, "g1", ExecutionBackend.RouterBridge);
      expect(store.get(ScopeType.Global, "g1")).not.toBeNull();

      const cleared = store.clear(ScopeType.Global, "g1");
      expect(cleared).toBe(true);
      expect(store.get(ScopeType.Global, "g1")).toBeNull();
    });

    it("returns false for non-existent scope", () => {
      expect(store.clear(ScopeType.Thread, "nonexistent")).toBe(false);
    });
  });

  describe("status()", () => {
    it("returns human-readable string for existing state", () => {
      store.set(ScopeType.Thread, "tid-1", ExecutionBackend.RouterBridge);
      const status = store.status(ScopeType.Thread, "tid-1");
      expect(status).toContain("router-bridge");
      expect(status).toContain("thread");
      expect(status).toContain("tid-1");
    });

    it("returns fallback message for unknown scope", () => {
      const status = store.status(ScopeType.Thread, "unknown");
      expect(status).toContain("No override set");
    });
  });

  describe("getEffective()", () => {
    it("returns thread-scoped when threadId provided", () => {
      store.set(ScopeType.Thread, "tid-100", ExecutionBackend.RouterBridge);
      store.set(ScopeType.Session, "sid-100", ExecutionBackend.RouterAcp);
      store.set(ScopeType.Global, "default", ExecutionBackend.Native);

      const effective = store.getEffective(ScopeType.Global, "default", "tid-100", "sid-100");
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });

    it("falls back to session when no thread override", () => {
      store.set(ScopeType.Session, "sid-200", ExecutionBackend.RouterAcp);
      store.set(ScopeType.Global, "default", ExecutionBackend.Native);

      const effective = store.getEffective(ScopeType.Global, "default", undefined, "sid-200");
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterAcp);
    });

    it("falls back to global when no thread/session override", () => {
      store.set(ScopeType.Global, "default", ExecutionBackend.RouterBridge);

      const effective = store.getEffective(ScopeType.Global, "default");
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });

    it("returns native when no overrides exist", () => {
      const effective = store.getEffective(ScopeType.Global, "default");
      expect(effective.executionBackend).toBe(ExecutionBackend.Native);
      expect(effective.scopeType).toBe(ScopeType.Global);
      expect(effective.scopeId).toBe("default");
    });
  });

  describe("persistence", () => {
    it("set → reload → get returns same state", () => {
      store.set(ScopeType.Thread, "persist-1", ExecutionBackend.RouterAcp);

      // Create a fresh store instance (simulates reload)
      const store2 = new ExecutionBackendStore();
      const fetched = store2.get(ScopeType.Thread, "persist-1");
      expect(fetched).not.toBeNull();
      expect(fetched!.executionBackend).toBe(ExecutionBackend.RouterAcp);
      expect(fetched!.scopeType).toBe(ScopeType.Thread);
      expect(fetched!.scopeId).toBe("persist-1");
    });
  });

  describe("corrupt file recovery", () => {
    it("recovers gracefully from invalid JSON", () => {
      const statePath = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, "{{not valid json!!!");

      // Should not throw, returns empty
      const result = store.get(ScopeType.Thread, "any");
      expect(result).toBeNull();
    });

    it("recovers from empty file", () => {
      const statePath = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, "");

      const result = store.get(ScopeType.Thread, "any");
      expect(result).toBeNull();
    });

    it("recovers from whitespace-only file", () => {
      const statePath = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, "   \n\t  ");

      const result = store.get(ScopeType.Thread, "any");
      expect(result).toBeNull();
    });

    it("set() works after corrupt file recovery", () => {
      const statePath = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, "CORRUPTED");

      store.set(ScopeType.Thread, "t1", ExecutionBackend.RouterBridge);
      const fetched = store.get(ScopeType.Thread, "t1");
      expect(fetched).not.toBeNull();
      expect(fetched!.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });
  });

  describe("atomic writes", () => {
    it("state file is valid JSON after write", () => {
      store.set(ScopeType.Thread, "t-atomic", ExecutionBackend.RouterBridge);
      const statePath = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");
      const raw = fs.readFileSync(statePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed["thread:t-atomic"]).toBeDefined();
      expect(parsed["thread:t-atomic"].executionBackend).toBe("router-bridge");
    });

    it("no .tmp files left after write", () => {
      store.set(ScopeType.Thread, "t-clean", ExecutionBackend.RouterBridge);
      const dir = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge");
      const files = fs.readdirSync(dir);
      const tmpFiles = files.filter(f => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("metadata preservation", () => {
    it("set() preserves threadId from existing state", () => {
      // First set with a store that has threadId (simulating commands.ts pattern)
      const statePath = path.join(TMP_DIR, ".openclaw/workspace/extensions/router-bridge/.router-state.json");
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({
        "thread:t1": {
          executionBackend: "native",
          scopeType: "thread",
          scopeId: "t1",
          threadId: "tid-999",
          sessionId: "sid-888",
          targetHarnessId: "harness-777",
        }
      }, null, 2));

      // Switch backend — metadata should be preserved
      store.set(ScopeType.Thread, "t1", ExecutionBackend.RouterBridge);
      const fetched = store.get(ScopeType.Thread, "t1");
      expect(fetched).not.toBeNull();
      expect(fetched!.executionBackend).toBe(ExecutionBackend.RouterBridge);
      expect(fetched!.threadId).toBe("tid-999");
      expect(fetched!.sessionId).toBe("sid-888");
      expect(fetched!.targetHarnessId).toBe("harness-777");
    });

    it("set() initializes null metadata when no existing state", () => {
      const result = store.set(ScopeType.Thread, "fresh", ExecutionBackend.RouterAcp);
      expect(result.threadId).toBeNull();
      expect(result.sessionId).toBeNull();
      expect(result.targetHarnessId).toBeNull();
    });
  });

  describe("getEffective edge cases", () => {
    it("with only threadId (no sessionId) skips session check", () => {
      store.set(ScopeType.Thread, "tid-only", ExecutionBackend.RouterBridge);
      store.set(ScopeType.Global, "default", ExecutionBackend.RouterAcp);

      const effective = store.getEffective(ScopeType.Global, "default", "tid-only");
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });

    it("with only sessionId (no threadId) falls to session", () => {
      store.set(ScopeType.Session, "sid-only", ExecutionBackend.RouterBridge);
      store.set(ScopeType.Global, "default", ExecutionBackend.RouterAcp);

      const effective = store.getEffective(ScopeType.Global, "default", undefined, "sid-only");
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });
  });

  describe("multiple scopes", () => {
    it("are independent", () => {
      store.set(ScopeType.Thread, "t1", ExecutionBackend.RouterBridge);
      store.set(ScopeType.Session, "s1", ExecutionBackend.RouterAcp);
      store.set(ScopeType.Global, "default", ExecutionBackend.Native);

      const t1 = store.get(ScopeType.Thread, "t1");
      const s1 = store.get(ScopeType.Session, "s1");
      const g1 = store.get(ScopeType.Global, "default");

      expect(t1!.executionBackend).toBe(ExecutionBackend.RouterBridge);
      expect(s1!.executionBackend).toBe(ExecutionBackend.RouterAcp);
      expect(g1!.executionBackend).toBe(ExecutionBackend.Native);

      // Clear one, others remain
      store.clear(ScopeType.Thread, "t1");
      expect(store.get(ScopeType.Thread, "t1")).toBeNull();
      expect(store.get(ScopeType.Session, "s1")).not.toBeNull();
      expect(store.get(ScopeType.Global, "default")).not.toBeNull();
    });
  });
});
