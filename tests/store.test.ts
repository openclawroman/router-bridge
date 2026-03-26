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
