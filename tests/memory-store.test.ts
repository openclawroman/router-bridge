import { beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getDelegationMemoryFilePath,
  storeDelegatedResult,
  storeDelegatedResultIfSuccessful,
  type DelegationEntry,
} from "../index";

const MEMORY_STORE_DIR = "/Users/openclaw/src/router-bridge/state/memory";
const mutableFs = createRequire(import.meta.url)("fs") as typeof import("fs");

function makeEntry(overrides: Partial<DelegationEntry> = {}): DelegationEntry {
  return {
    task_id: overrides.task_id ?? `task-${Date.now()}-${Math.random()}`,
    thread_id: overrides.thread_id ?? "thread-1",
    session_id: overrides.session_id ?? "session-1",
    timestamp: overrides.timestamp ?? Date.now(),
    tool: overrides.tool ?? "codex_cli",
    backend: overrides.backend ?? "openai_native",
    model: overrides.model ?? "gpt-5",
    task: overrides.task ?? "build a feature",
    output: overrides.output ?? "delegation output",
    cwd: overrides.cwd ?? process.cwd(),
  };
}

function resetStore() {
  fs.rmSync(MEMORY_STORE_DIR, { recursive: true, force: true });
  fs.mkdirSync(MEMORY_STORE_DIR, { recursive: true });
}

function readEntries(threadId?: string | null, sessionId?: string | null): DelegationEntry[] {
  const filePath = getDelegationMemoryFilePath(threadId ?? null, sessionId ?? null);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

test("save success result -> entry written to correct file", () => {
  const entry = makeEntry({
    thread_id: "thread:alpha",
    session_id: "session-1",
    task_id: "task-1",
    output: "full result output",
  });

  const ok = storeDelegatedResult(entry);
  assert.equal(ok, true);

  const filePath = getDelegationMemoryFilePath("thread:alpha", "session-1");
  assert.equal(fs.existsSync(filePath), true);

  const entries = JSON.parse(fs.readFileSync(filePath, "utf8")) as DelegationEntry[];
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], entry);
});

test("failed delegation (result.success=false) -> nothing stored", () => {
  const entry = makeEntry({
    thread_id: "thread-failed",
    session_id: "session-failed",
    task_id: "task-failed",
  });

  assert.equal(storeDelegatedResultIfSuccessful(false, entry), false);
  assert.equal(fs.readdirSync(MEMORY_STORE_DIR).length, 0);
});

test("6 entries -> oldest evicted, only 5 remain", () => {
  for (let i = 1; i <= 6; i += 1) {
    assert.equal(
      storeDelegatedResult(
        makeEntry({
          thread_id: "thread-ring",
          session_id: "session-ring",
          task_id: `task-${i}`,
          output: `output-${i}`,
          timestamp: 1000 + i,
        })
      ),
      true
    );
  }

  const entries = readEntries("thread-ring", "session-ring");
  assert.equal(entries.length, 5);
  assert.deepEqual(
    entries.map((entry) => entry.task_id),
    ["task-2", "task-3", "task-4", "task-5", "task-6"]
  );
});

test("separate thread_id -> isolated history files", () => {
  assert.equal(
    storeDelegatedResult(makeEntry({ thread_id: "thread-a", session_id: "session-shared", task_id: "task-a", output: "a" })),
    true
  );
  assert.equal(
    storeDelegatedResult(makeEntry({ thread_id: "thread-b", session_id: "session-shared", task_id: "task-b", output: "b" })),
    true
  );

  const fileA = getDelegationMemoryFilePath("thread-a", "session-shared");
  const fileB = getDelegationMemoryFilePath("thread-b", "session-shared");

  assert.equal(fs.existsSync(fileA), true);
  assert.equal(fs.existsSync(fileB), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(fileA, "utf8")).map((entry: DelegationEntry) => entry.task_id), ["task-a"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(fileB, "utf8")).map((entry: DelegationEntry) => entry.task_id), ["task-b"]);
});

test("no thread_id -> session_id fallback works", () => {
  const entry = makeEntry({
    thread_id: "",
    session_id: "session-fallback",
    task_id: "task-fallback",
    output: "fallback-output",
  });

  assert.equal(storeDelegatedResult(entry), true);

  const expectedPath = getDelegationMemoryFilePath(null, "session-fallback");
  assert.equal(fs.existsSync(expectedPath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(expectedPath, "utf8")).map((stored: DelegationEntry) => stored.task_id), ["task-fallback"]);
});

test("missing store dir -> created automatically", () => {
  fs.rmSync(MEMORY_STORE_DIR, { recursive: true, force: true });
  assert.equal(fs.existsSync(MEMORY_STORE_DIR), false);

  assert.equal(
    storeDelegatedResult(makeEntry({ thread_id: "thread-create", session_id: "session-create", task_id: "task-create" })),
    true
  );

  assert.equal(fs.existsSync(MEMORY_STORE_DIR), true);
  assert.equal(fs.existsSync(getDelegationMemoryFilePath("thread-create", "session-create")), true);
});

test("store write failure -> does not throw, plugin continues", () => {
  const originalWriteFileSync = mutableFs.writeFileSync;
  const originalRenameSync = mutableFs.renameSync;

  try {
    mutableFs.writeFileSync = (() => {
      throw new Error("disk full");
    }) as typeof fs.writeFileSync;
    mutableFs.renameSync = (() => {
      throw new Error("rename should not be reached");
    }) as typeof fs.renameSync;

    let ok = true;
    assert.doesNotThrow(() => {
      ok = storeDelegatedResult(makeEntry({ thread_id: "thread-fail", session_id: "session-fail", task_id: "task-fail" }));
    });
    assert.equal(ok, false);
  } finally {
    mutableFs.writeFileSync = originalWriteFileSync;
    mutableFs.renameSync = originalRenameSync;
  }
});
