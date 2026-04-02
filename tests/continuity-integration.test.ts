import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import {
  storeDelegatedResult,
  getDelegationMemoryFilePath,
  loadEntriesForContext,
  renderContinuitySummary,
  shouldInjectContinuity,
  getRelevantFullEntries,
  getContinuitySummary,
  type DelegationEntry,
} from "../index";

const NOW = 1_700_000_000_000;
const WINDOW_MS = 45 * 60 * 1000;

function makeEntry(overrides: Partial<DelegationEntry> = {}): DelegationEntry {
  return {
    task_id: overrides.task_id ?? `task-${Math.random()}`,
    thread_id: overrides.thread_id ?? "thread-int",
    session_id: overrides.session_id ?? "session-int",
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

// ── Bridge Integration: Full Output vs Summary ─────────────────────

test("full output stored in store, not truncated", () => {
  const tid = "int-full-store";
  const sid = "int-full-store-s";
  cleanup(tid, sid);

  const largeOutput = "Line 1\n".repeat(500) + "END";
  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    output: largeOutput,
  }));

  const entries = loadEntriesForContext(tid, sid);
  assert.equal(entries.length, 1);
  // Full output preserved in store
  assert.equal(entries[0].output, largeOutput);

  cleanup(tid, sid);
});

test("continuity summary is compact, not full output", () => {
  const tid = "int-compact-summary";
  const sid = "int-compact-summary-s";
  cleanup(tid, sid);

  const largeOutput = "Very detailed output:\n" + "x".repeat(3000);
  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 60_000,
    task: "Build auth module",
    output: largeOutput,
  }));

  const summary = getContinuitySummary(tid, sid);
  assert.ok(summary);
  // Summary is bounded, NOT the full output
  assert.ok(summary!.length < 700);
  assert.ok(summary!.includes("Build auth module"));
  // Full raw output should NOT appear in summary
  assert.ok(!summary!.includes("Very detailed output:\n" + "x".repeat(3000)));

  cleanup(tid, sid);
});

test("retrieval returns bounded output, not all 5 full outputs", () => {
  const tid = "int-ret-bounded";
  const sid = "int-ret-bounded-s";
  cleanup(tid, sid);

  for (let i = 0; i < 5; i++) {
    storeDelegatedResult(makeEntry({
      task_id: `task-${i}`,
      thread_id: tid, session_id: sid,
      timestamp: NOW - (i + 1) * 10_000,
      output: `Full output for task ${i}: ${"x".repeat(3000)}`,
    }));
  }

  const entries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 2);
  // Max 2 entries, NOT all 5
  assert.equal(entries.length <= 2, true);
  // Each entry output bounded to 2000 chars
  for (const entry of entries) {
    assert.ok(entry.output.length <= 2003);
  }

  cleanup(tid, sid);
});

test("gate blocks stale delegation, summary not injected", () => {
  const tid = "int-gate-block";
  const sid = "int-gate-block-s";
  cleanup(tid, sid);

  storeDelegatedResult(makeEntry({
    thread_id: tid, session_id: sid,
    timestamp: NOW - 120 * 60 * 1000, // 2 hours ago
  }));

  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "history too old");

  // Summary exists in store but gate blocks injection
  const rawSummary = getContinuitySummary(tid, sid);
  assert.ok(rawSummary); // Store has data
  // But gate would prevent it from reaching transport

  cleanup(tid, sid);
});

test("e2e bridge flow: delegate -> store -> summary -> transport", () => {
  const tid = "int-e2e";
  const sid = "int-e2e-s";
  cleanup(tid, sid);

  // Step 1: First delegation succeeds
  const task1Output = "Created src/auth.ts with JWT validation";
  storeDelegatedResult(makeEntry({
    task_id: "task-1",
    thread_id: tid, session_id: sid,
    timestamp: NOW - 5 * 60 * 1000, // 5 min ago
    task: "Add auth module",
    output: task1Output,
  }));

  // Step 2: Second delegation in same thread, soon after
  const gate = shouldInjectContinuity(tid, sid, null, NOW, WINDOW_MS);
  assert.equal(gate.inject, true);

  // Step 3: Summary is compact and includes task-1 context
  const summary = getContinuitySummary(tid, sid);
  assert.ok(summary);
  assert.ok(summary!.includes("Add auth module"));

  // Step 4: Full output NOT in summary (compact only)
  assert.ok(!summary!.includes("Created src/auth.ts"));

  // Step 5: Full output available via retrieval if needed
  const fullEntries = getRelevantFullEntries(tid, sid, null, NOW, WINDOW_MS, 1);
  assert.equal(fullEntries.length, 1);
  assert.equal(fullEntries[0].output, task1Output); // Full output preserved

  // Step 6: Even with 5 entries, summary stays bounded
  for (let i = 2; i <= 5; i++) {
    storeDelegatedResult(makeEntry({
      task_id: `task-${i}`,
      thread_id: tid, session_id: sid,
      timestamp: NOW - i * 60_000,
      output: `Output ${i}: ${"x".repeat(2000)}`,
    }));
  }

  const boundedSummary = getContinuitySummary(tid, sid);
  assert.ok(boundedSummary);
  assert.ok(boundedSummary!.length <= 700);
  // 5 full outputs NOT blindly appended
  assert.ok(!boundedSummary!.includes("x".repeat(2000)));

  cleanup(tid, sid);
});

test("thread isolation: different threads do not share continuity", () => {
  const tidA = "int-isolate-a";
  const tidB = "int-isolate-b";
  const sid = "int-isolate-s";
  cleanup(tidA, sid);
  cleanup(tidB, sid);

  storeDelegatedResult(makeEntry({
    task_id: "task-a1",
    thread_id: tidA, session_id: sid,
    timestamp: NOW - 60_000,
    task: "Build feature A",
  }));

  storeDelegatedResult(makeEntry({
    task_id: "task-b1",
    thread_id: tidB, session_id: sid,
    timestamp: NOW - 60_000,
    task: "Build feature B",
  }));

  const summaryA = getContinuitySummary(tidA, sid);
  const summaryB = getContinuitySummary(tidB, sid);

  assert.ok(summaryA!.includes("Build feature A"));
  assert.ok(!summaryA!.includes("Build feature B"));

  assert.ok(summaryB!.includes("Build feature B"));
  assert.ok(!summaryB!.includes("Build feature A"));

  cleanup(tidA, sid);
  cleanup(tidB, sid);
});
