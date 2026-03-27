/**
 * Scope-aware delegation integration tests.
 *
 * Verifies that the hook properly delegates when /router on
 * is called with specific scope (thread or session), and the
 * hook fires with matching context.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionBackendStore } from "../../src/store";
import { ExecutionBackend, ScopeType } from "../../src/types";
import { extractRuntimeScope } from "../../src/scope";
import { DEFAULT_CONFIG } from "../../src/types";

describe("Scope-aware delegation", () => {
  let store: ExecutionBackendStore;

  beforeEach(() => {
    store = new ExecutionBackendStore();
    // Clean all entries
    const fs = require("fs");
    const statePath = require("path").join(
      __dirname,
      "../../runtime/bridge/state.json"
    );
    try {
      fs.unlinkSync(statePath);
    } catch {}
  });

  describe("extractRuntimeScope", () => {
    it("resolves thread scope from hookCtx.sessionKey", () => {
      const ctx = { sessionKey: "tg-123", sessionId: "s-456" };
      const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread };
      const scope = extractRuntimeScope(ctx, config);

      expect(scope.scopeType).toBe(ScopeType.Thread);
      expect(scope.threadId).toBe("tg-123");
      expect(scope.sessionId).toBe("s-456");
      expect(scope.scopeId).toBe("tg-123");
    });

    it("resolves session scope from hookCtx.sessionId", () => {
      const ctx = { sessionKey: "tg-123", sessionId: "s-456" };
      const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Session };
      const scope = extractRuntimeScope(ctx, config);

      expect(scope.scopeType).toBe(ScopeType.Session);
      expect(scope.scopeId).toBe("s-456");
    });

    it("falls back to 'default' when no IDs provided", () => {
      const ctx = {};
      const config = { ...DEFAULT_CONFIG, scopeMode: ScopeType.Thread };
      const scope = extractRuntimeScope(ctx, config);

      expect(scope.scopeId).toBe("default");
      expect(scope.threadId).toBeNull();
      expect(scope.sessionId).toBeNull();
    });
  });

  describe("thread scope delegation", () => {
    it("/router on for threadId → getEffective finds it", () => {
      store.set(
        ScopeType.Thread,
        "scope-test-1",
        ExecutionBackend.RouterBridge
      );

      const effective = store.getEffective(
        ScopeType.Thread,
        "scope-test-1",
        "scope-test-1",
        undefined
      );
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });
  });

  describe("session scope delegation", () => {
    it("/router on for sessionId → getEffective finds it", () => {
      store.set(
        ScopeType.Session,
        "sess-test-1",
        ExecutionBackend.RouterBridge
      );

      const effective = store.getEffective(
        ScopeType.Session,
        "sess-test-1",
        undefined,
        "sess-test-1"
      );
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });
  });

  describe("default scope delegation", () => {
    it("/router on default → getEffective with threadId=undefined finds it via scopeId", () => {
      store.set(
        ScopeType.Thread,
        "default",
        ExecutionBackend.RouterBridge
      );

      // This is what the hook does: scopeId="default", no threadId, no sessionId
      const effective = store.getEffective(
        ScopeType.Thread,
        "default",
        undefined,
        undefined
      );
      expect(effective.executionBackend).toBe(ExecutionBackend.RouterBridge);
    });
  });
});
