import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ensureRuntimeDirectories,
  validateStateIntegrity,
  repairStateFile,
} from "../src/store";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("State layer separation and recovery", () => {
  const TMP_DIR = path.join(os.tmpdir(), `router-bridge-state-test-${process.pid}-${Date.now()}`);
  const ROUTER_ROOT = path.join(TMP_DIR, "router");
  const STATE_FILE = path.join(ROUTER_ROOT, "runtime", "bridge", "state.json");
  const originalEnv = process.env.OPENCLAW_ROUTER_ROOT;

  beforeEach(() => {
    process.env.OPENCLAW_ROUTER_ROOT = ROUTER_ROOT;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENCLAW_ROUTER_ROOT = originalEnv;
    } else {
      delete process.env.OPENCLAW_ROUTER_ROOT;
    }
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  describe("ensureRuntimeDirectories", () => {
    it("creates bridge and router runtime directories", () => {
      ensureRuntimeDirectories();

      expect(fs.existsSync(path.join(ROUTER_ROOT, "runtime", "bridge"))).toBe(true);
      expect(fs.existsSync(path.join(ROUTER_ROOT, "runtime", "router"))).toBe(true);
    });

    it("is idempotent — calling twice does not throw", () => {
      ensureRuntimeDirectories();
      ensureRuntimeDirectories();

      expect(fs.existsSync(path.join(ROUTER_ROOT, "runtime", "bridge"))).toBe(true);
      expect(fs.existsSync(path.join(ROUTER_ROOT, "runtime", "router"))).toBe(true);
    });
  });

  describe("validateStateIntegrity", () => {
    it("returns valid with fresh-install message when no state file exists", () => {
      const result = validateStateIntegrity();
      expect(result.valid).toBe(true);
      expect(result.issues).toContain("No state file (fresh install)");
    });

    it("returns valid for a clean state file", () => {
      ensureRuntimeDirectories();
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        "thread:t1": {
          executionBackend: "router-bridge",
          scopeType: "thread",
          scopeId: "t1",
          threadId: "tid-1",
          sessionId: null,
          targetHarnessId: null,
        },
      }));

      const result = validateStateIntegrity();
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("detects corrupt JSON", () => {
      ensureRuntimeDirectories();
      fs.writeFileSync(STATE_FILE, "{{not valid json");

      const result = validateStateIntegrity();
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatch(/Corrupt state file/);
    });

    it("detects invalid entries (non-object values)", () => {
      ensureRuntimeDirectories();
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        "thread:t1": "not an object",
        "thread:t2": {
          executionBackend: "router-bridge",
          scopeType: "thread",
          scopeId: "t2",
          threadId: null,
          sessionId: null,
          targetHarnessId: null,
        },
      }));

      const result = validateStateIntegrity();
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Invalid state entry for key: thread:t1");
    });

    it("detects missing required fields", () => {
      ensureRuntimeDirectories();
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        "thread:t1": {
          executionBackend: "router-bridge",
          // missing scopeType and scopeId
        },
      }));

      const result = validateStateIntegrity();
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("Missing scopeType in thread:t1");
      expect(result.issues).toContain("Missing scopeId in thread:t1");
    });
  });

  describe("repairStateFile", () => {
    it("returns message when no state file exists", () => {
      const result = repairStateFile();
      expect(result).toBe("No state file to repair");
    });

    it("backs up and repairs file with invalid entries", () => {
      ensureRuntimeDirectories();
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        "thread:t1": {
          executionBackend: "router-bridge",
          scopeType: "thread",
          scopeId: "t1",
          threadId: null,
          sessionId: null,
          targetHarnessId: null,
        },
        "thread:t2": {
          // invalid — missing required fields
          executionBackend: null,
        },
        "thread:t3": "completely wrong",
      }));

      const result = repairStateFile();
      expect(result).toMatch(/Repaired/);
      expect(result).toMatch(/Backup at/);

      // Verify backup was created
      const backupFiles = fs.readdirSync(path.join(ROUTER_ROOT, "runtime", "bridge"))
        .filter(f => f.startsWith("state.json.backup."));
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);

      // Verify cleaned state
      const cleaned = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      expect(cleaned["thread:t1"]).toBeDefined();
      expect(cleaned["thread:t2"]).toBeUndefined();
      expect(cleaned["thread:t3"]).toBeUndefined();
    });

    it("resets fully corrupt file and creates backup", () => {
      ensureRuntimeDirectories();
      fs.writeFileSync(STATE_FILE, "THIS IS NOT JSON AT ALL {{{");

      const result = repairStateFile();
      expect(result).toMatch(/State file corrupted/);
      expect(result).toMatch(/Reset to empty/);
      expect(result).toMatch(/Backup at/);

      // Verify reset to empty
      const cleaned = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      expect(cleaned).toEqual({});

      // Verify backup was created
      const backupFiles = fs.readdirSync(path.join(ROUTER_ROOT, "runtime", "bridge"))
        .filter(f => f.startsWith("state.json.backup."));
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);
    });
  });
});
