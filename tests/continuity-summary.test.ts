import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import { getDelegationMemoryFilePath, getContinuitySummary, loadEntriesForContext, formatTimeAgo, renderContinuitySummary, extractFragment, type DelegationEntry } from "../index";

const MEMORY_STORE_DIR = "/Users/openclaw/src/router-bridge/state/memory";

function makeEntry(overrides: Partial<DelegationEntry> = {}): DelegationEntry {
  return {
    task_id: overrides.task_id ?? `task-${Math.random()}`,
    thread_id: overrides.thread_id ?? "thread-summary",
    session_id: overrides.session_id ?? "session-summary",
    timestamp: overrides.timestamp ?? Date.now(),
    tool: overrides.tool ?? "codex_cli",
    backend: overrides.backend ?? "openai_native",
    model: overrides.model ?? "gpt-5",
    task: overrides.task ?? "build a feature",
    output: overrides.output ?? "delegation output",
    cwd: overrides.cwd ?? process.cwd(),
  };
}

function withMockedNow(now: number, fn: () => void): void {
  const originalNow = Date.now;
  (Date as any).now = () => now;
  try {
    fn();
  } finally {
    (Date as any).now = originalNow;
  }
}

test("empty store -> null summary", () => {
  assert.equal(renderContinuitySummary([]), null);
});

test("1 entry -> summary rendered", () => {
  withMockedNow(1_000_000, () => {
    const entry = makeEntry({
      timestamp: 1_000_000 - 120_000,
      task: "Implement fragment extraction",
      output: "Updated src/index.ts and tests/continuity-summary.test.ts",
    });
    const summary = renderContinuitySummary([entry]);

    assert.ok(summary);
    assert.match(extractFragment(entry), /Implement fragment extraction/);
    assert.match(summary, /Implement fragment extraction/);
    assert.match(summary, /src\/index\.ts/);
  });
});

test("5 entries -> bounded summary", () => {
  withMockedNow(1_000_000, () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry({
        task_id: `task-${index + 1}`,
        timestamp: 1_000_000 - index * 60_000,
        task: `Task ${index + 1}`,
        output: `Output ${index + 1}`,
      })
    );

    const summary = renderContinuitySummary(entries);
    assert.ok(summary);
    assert.ok(summary.length <= 700);
    assert.ok(summary.split("\n").length <= 8);
  });
});

test("5 entries uses ring buffer", () => {
  withMockedNow(1_000_000, () => {
    const entries = Array.from({ length: 6 }, (_, index) =>
      makeEntry({
        task_id: `task-${index + 1}`,
        timestamp: 1_000_000 - (6 - index) * 60_000,
        task: `Task ${index + 1}`,
        output: `Output ${index + 1}`,
      })
    );

    const summary = renderContinuitySummary(entries);
    assert.ok(summary);
    assert.equal(summary.includes("Task 1"), false);
    assert.equal(summary.includes("Task 2"), true);
    assert.equal(summary.includes("Task 6"), true);
  });
});

test("malformed entry does not crash", () => {
  withMockedNow(1_000_000, () => {
    assert.doesNotThrow(() => {
      const summary = renderContinuitySummary([
        {
          task_id: null,
          thread_id: undefined,
          session_id: undefined,
          timestamp: undefined,
          tool: undefined,
          backend: undefined,
          model: undefined,
          task: undefined,
          output: undefined,
          cwd: undefined,
        } as any,
      ]);

      assert.ok(summary);
      assert.match(summary, /unknown task/);
    });
  });
});

test("newest entry has priority", () => {
  withMockedNow(1_000_000, () => {
    const summary = renderContinuitySummary([
      makeEntry({ task_id: "old", timestamp: 1_000_000 - 3_600_000, task: "Old task", output: "old output" }),
      makeEntry({ task_id: "new", timestamp: 1_000_000 - 60_000, task: "New task", output: "new output" }),
    ]);

    assert.ok(summary);
    const firstLine = summary.split("\n")[1];
    assert.match(firstLine, /New task/);
  });
});

test("summary size bound enforced", () => {
  withMockedNow(1_000_000, () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      makeEntry({
        task_id: `verbose-${index + 1}`,
        timestamp: 1_000_000 - index * 60_000,
        task: `Implement a very verbose continuity summary test case ${index + 1}`,
        output:
          "This is a very long output fragment that should be truncated because it would otherwise exceed the summary size bound. " +
          "It mentions src/router.ts, tests/continuity-summary.test.ts, and several other files to exercise truncation behavior.",
      })
    );

    const summary = renderContinuitySummary(entries);
    assert.ok(summary);
    assert.ok(summary.length <= 700);
  });
});

test("getContinuitySummary convenience", () => {
  withMockedNow(1_000_000, () => {
    const threadId = "thread-summary-load";
    const sessionId = "session-summary-load";
    const filePath = getDelegationMemoryFilePath(threadId, sessionId);
    fs.rmSync(MEMORY_STORE_DIR, { recursive: true, force: true });
    try {
      fs.mkdirSync(MEMORY_STORE_DIR, { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          [
            makeEntry({
              task_id: "load-1",
              thread_id: threadId,
              session_id: sessionId,
              timestamp: 1_000_000 - 120_000,
              task: "Load continuity summary",
              output: "Saved state in state/memory/thread-summary-load.json",
            }),
          ],
          null,
          2
        ),
        "utf8"
      );

      const loaded = loadEntriesForContext(threadId, sessionId);
      assert.equal(loaded.length, 1);

      const summary = getContinuitySummary(threadId, sessionId);
      assert.ok(summary);
      assert.match(summary, /Load continuity summary/);
      assert.match(summary, /thread-summary-load\.json/);
    } finally {
      fs.rmSync(MEMORY_STORE_DIR, { recursive: true, force: true });
    }
  });
});

test("time_ago formatting", () => {
  withMockedNow(1_000_000, () => {
    assert.equal(formatTimeAgo(1_000_000 - 10_000), "just now");
    assert.equal(formatTimeAgo(1_000_000 - 120_000), "2m ago");
    assert.equal(formatTimeAgo(1_000_000 - 3_600_000), "1h ago");
  });
});
