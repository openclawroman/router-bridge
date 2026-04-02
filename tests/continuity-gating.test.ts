import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  shouldInjectContinuity,
  getRelevantFullEntries,
  getDelegationMemoryFilePath,
  storeDelegatedResult,
  type DelegationEntry,
} from "../index";

const MEMORY_STORE_DIR = path.join(__dirname, "..", "state", "memory");
const NOW = 1_700_000_000_000;
const WINDOW_MS = 45 * 60 * 1000;

function makeEntry(overrides: Partial<DelegationEntry> = {}): DelegationEntry {
  return {
    task_id: overrides.task_id ?? `task-${Math.random()}`,
    thread_id: overrides.thread_id ?? "thread-gate",
    session_id: overrides.session_id ?? "session-gate",
    timestamp: overrides.timestamp ?? NOW - 60_000,
    tool: overrides.tool ?? "codex_cli",
    backend: overrides.backend ?? "openai_native",
    model: overrides.model ?? "gpt-5",
    task: overrides.task ?? "build a feature",
    output: overrides.output ?? "delegation output",
    cwd: overrides.cwd ?? "/repos/my-project",
  };
}

function cleanup(threadId: string, sessionId: string) {
  fs.rmSync(getDelegationMemoryFilePath(threadId, sessionId), { force: true });
}

// ── Phase 5: Deterministic Gating ─────────────────────────────────

test("same thread + recent -> inject=true", () => {
  const tid = "gate-1";
  const sid = "gate-1-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000, // 1 min ago
  }));

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, true);
  assert.equal(gate.reason, "ok");
  assert.equal(gate.threadMatch, true);
  assert.equal(gate.hasHistory, true);
  assert.equal(gate.recentEnough, true);

  cleanup(tid, sid);
});

test("no thread id -> inject=false", () => {
  const gate = shouldInjectContinuity(null, "some-session", null, NOW, WINDOW_MS);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "no thread id");
  assert.equal(gate.threadMatch, false);
});

test("empty thread id -> inject=false", () => {
  const gate = shouldInjectContinuity("", null, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "no thread id");
});

test("no history -> inject=false", () => {
  const tid = "gate-empty";
  const sid = "gate-empty-s";
  cleanup(tid, sid);

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "no history");
  assert.equal(gate.threadMatch, true);
  assert.equal(gate.hasHistory, false);
});

test("stale history (>45 min) -> inject=false", () => {
  const tid = "gate-stale";
  const sid = "gate-stale-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60 * 60 * 1000, // 60 min ago
  }));

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "history too old");
  assert.equal(gate.recentEnough, false);

  cleanup(tid, sid);
});

test("cwd mismatch -> inject=false", () => {
  const tid = "gate-cwd";
  const sid = "gate-cwd-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    cwd: "/repos/project-a",
  }));

  const gate = shouldInjectContinuity(tid, sid, "/repos/project-b", NOW, WINDOW_MS);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "cwd mismatch");
  assert.equal(gate.cwdMatch, false);

  cleanup(tid, sid);
});

test("cwd match -> inject=true", () => {
  const tid = "gate-cwd-match";
  const sid = "gate-cwd-match-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    cwd: "/repos/project-a",
  }));

  const gate = shouldInjectContinuity(tid, sid, "/repos/project-a", NOW, WINDOW_MS);
  assert.equal(gate.inject, true);
  assert.equal(gate.cwdMatch, true);

  cleanup(tid, sid);
});

test("cwd null on both sides -> inject=true (gate skipped)", () => {
  const tid = "gate-no-cwd";
  const sid = "gate-no-cwd-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    cwd: undefined,
  }));

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, true);
  assert.equal(gate.cwdMatch, null);

  cleanup(tid, sid);
});

test("boundary: exactly at window edge -> inject=true", () => {
  const tid = "gate-boundary";
  const sid = "gate-boundary-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - WINDOW_MS,
  }));

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, true);

  cleanup(tid, sid);
});

test("boundary: just past window -> inject=false", () => {
  const tid = "gate-boundary-out";
  const sid = "gate-boundary-out-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - WINDOW_MS - 1,
  }));

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, false);

  cleanup(tid, sid);
});

// ── Phase 6: Selective Full Retrieval ──────────────────────────────

test("retrieval: returns at most 2 entries", () => {
  const tid = "ret-max";
  const sid = "ret-max-s";
  cleanup(tid, sid);

  for (let i = 0; i < 5; i++) {
    storeDelegatedResult(makeEntry({
      task_id: `task-${i}`,
      thread_id: tid, session_id: sid,
      timestamp: NOW - (i + 1) * 10_000,
    }));
  }

  const entries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 2);
  assert.equal(entries.length <= 2, true);

  cleanup(tid, sid);
});

test("retrieval: filters by recency window", () => {
  const tid = "ret-recent";
  const sid = "ret-recent-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    task_id: "task-old",
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60 * 60 * 1000, // 60 min ago — stale
  }));
  storeDelegatedResult(makeEntry({
    task_id: "task-fresh",
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000, // 1 min ago — fresh
  }));

  const entries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].task_id, "task-fresh");

  cleanup(tid, sid);
});

test("retrieval: filters by cwd match", () => {
  const tid = "ret-cwd";
  const sid = "ret-cwd-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    task_id: "task-a",
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    cwd: "/repos/a",
  }));
  storeDelegatedResult(makeEntry({
    task_id: "task-b",
    thread_id: tid, session_id: sid,
    timestamp: NOW - 30_000,
    cwd: "/repos/b",
  }));

  const entries = getRelevantFullEntries(tid, sid, "/repos/b", NOW, WINDOW_MS, 2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].task_id, "task-b");

  cleanup(tid, sid);
});

test("retrieval: bounded output for large outputs", () => {
  const tid = "ret-bounded";
  const sid = "ret-bounded-s";
  cleanup(tid, sid);

  const hugeOutput = "x".repeat(5000);
  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    output: hugeOutput,
  }));

  const entries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].output.length <= 2003, true); // 2000 + "..."
  assert.ok(entries[0].output.endsWith("..."));

  cleanup(tid, sid);
});

test("retrieval: empty store returns empty array", () => {
  const tid = "ret-empty";
  const sid = "ret-empty-s";
  cleanup(tid, sid);

  const entries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 2);
  assert.deepEqual(entries, []);
});

test("retrieval: no thread returns empty array", () => {
  const entries = getRelevantFullEntries(null, null, null, NOW, WINDOW_MS, 2);
  assert.deepEqual(entries, []);
});

test("retrieval: maxEntries capped at 2", () => {
  const tid = "ret-cap";
  const sid = "ret-cap-s";
  cleanup(tid, sid);

  for (let i = 0; i < 5; i++) {
    storeDelegatedResult(makeEntry({
      thread_id: tid, session_id: sid,
      timestamp: NOW - (i + 1) * 10_000,
    }));
  }

  // Ask for 10, should get at most 2
  const entries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 10);
  assert.equal(entries.length <= 2, true);

  cleanup(tid, sid);
});
