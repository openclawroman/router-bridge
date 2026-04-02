import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SubprocessRouterAdapter } from "../src/adapters";
import { getContinuitySummary, getDelegationMemoryFilePath, storeDelegatedResult, type DelegationEntry } from "../index";

const RESPONDER_SCRIPT = path.join(os.tmpdir(), "router-bridge-continuity-transport-responder.mjs");

function makeEntry(overrides: Partial<DelegationEntry> = {}): DelegationEntry {
  return {
    task_id: overrides.task_id ?? `task-${Math.random()}`,
    thread_id: overrides.thread_id ?? "thread-transport",
    session_id: overrides.session_id ?? "session-transport",
    timestamp: overrides.timestamp ?? Date.now(),
    tool: overrides.tool ?? "codex_cli",
    backend: overrides.backend ?? "openai_native",
    model: overrides.model ?? "gpt-5",
    task: overrides.task ?? "build a feature",
    output: overrides.output ?? "delegation output",
    cwd: overrides.cwd ?? process.cwd(),
  };
}

function ensureResponderScript(): string {
  if (!fs.existsSync(RESPONDER_SCRIPT)) {
    fs.writeFileSync(
      RESPONDER_SCRIPT,
      [
        'import { stdin, stdout } from "node:process";',
        'let input = "";',
        'stdin.setEncoding("utf8");',
        'stdin.on("data", (chunk) => { input += chunk; });',
        'stdin.on("end", () => {',
        '  stdout.write(JSON.stringify({ success: true, protocol_version: 1, final_summary: input }));',
        '});',
      ].join("\n"),
      "utf8"
    );
  }

  return RESPONDER_SCRIPT;
}

function clearMemoryEntry(threadId: string, sessionId: string): void {
  fs.rmSync(getDelegationMemoryFilePath(threadId, sessionId), { force: true });
}

function parsePayload(resultOutput: string): any {
  return JSON.parse(resultOutput);
}

test("payload includes continuity_summary when renderer returns value", async () => {
  const threadId = "thread-include";
  const sessionId = "session-include";
  const filePath = getDelegationMemoryFilePath(threadId, sessionId);
  clearMemoryEntry(threadId, sessionId);

  storeDelegatedResult(
    makeEntry({
      task_id: "task-include-1",
      thread_id: threadId,
      session_id: sessionId,
      timestamp: Date.now() - 120_000,
      task: "Implement continuity transport",
      output: "Updated src/adapters/subprocess.ts and index.ts",
    })
  );

  const summary = getContinuitySummary(threadId, sessionId);
  assert.ok(summary);

  const adapter = new SubprocessRouterAdapter({
    routerCommand: `node ${ensureResponderScript()}`,
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  const result = await adapter.execute({
    task: "Implement continuity transport",
    taskId: "task-include",
    scopeId: "scope-include",
    threadId,
    sessionId,
    prompt: "Implement continuity transport",
    continuitySummary: summary,
  });

  assert.equal(result.success, true);
  const payload = parsePayload(result.output);
  assert.equal(payload.continuity_summary, summary);
  assert.equal(payload.task, "Implement continuity transport");
  assert.equal(payload.prompt, "Implement continuity transport");
  assert.equal(payload.continuity_summary.length <= 700, true);
  assert.equal(fs.existsSync(filePath), true);
});

test("payload omits field when summary absent", async () => {
  clearMemoryEntry("thread-omit", "session-omit");
  const adapter = new SubprocessRouterAdapter({
    routerCommand: `node ${ensureResponderScript()}`,
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  const result = await adapter.execute({
    task: "No summary task",
    taskId: "task-omit",
    scopeId: "scope-omit",
    prompt: "No summary prompt",
    continuitySummary: null,
  });

  const payload = parsePayload(result.output);
  assert.equal(Object.hasOwn(payload, "continuity_summary"), false);
});

test("task remains unchanged", async () => {
  clearMemoryEntry("thread-task", "session-task");
  const adapter = new SubprocessRouterAdapter({
    routerCommand: `node ${ensureResponderScript()}`,
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  const result = await adapter.execute({
    task: "Task stays the same",
    taskId: "task-stays",
    scopeId: "scope-stays",
    prompt: "Prompt stays the same",
    continuitySummary: "Recent coding work:\n- example entry (codex_cli, just now)",
  });

  const payload = parsePayload(result.output);
  assert.equal(payload.task, "Task stays the same");
});

test("prompt remains unchanged", async () => {
  clearMemoryEntry("thread-prompt", "session-prompt");
  const adapter = new SubprocessRouterAdapter({
    routerCommand: `node ${ensureResponderScript()}`,
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  const result = await adapter.execute({
    task: "Prompt check task",
    taskId: "task-prompt",
    scopeId: "scope-prompt",
    prompt: "Prompt stays the same",
    continuitySummary: "Recent coding work:\n- example entry (codex_cli, just now)",
  });

  const payload = parsePayload(result.output);
  assert.equal(payload.prompt, "Prompt stays the same");
});

test("backward compat: old envelope without continuitySummary works identically", async () => {
  clearMemoryEntry("thread-compat", "session-compat");
  const adapter = new SubprocessRouterAdapter({
    routerCommand: `node ${ensureResponderScript()}`,
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  const baseEnvelope = {
    task: "Backward compat task",
    taskId: "task-compat",
    scopeId: "scope-compat",
    prompt: "Backward compat prompt",
    threadId: "thread-compat",
    sessionId: "session-compat",
  };

  const withoutSummary = await adapter.execute(baseEnvelope);
  const withUndefinedSummary = await adapter.execute({ ...baseEnvelope, continuitySummary: undefined });

  assert.deepEqual(parsePayload(withoutSummary.output), parsePayload(withUndefinedSummary.output));
});

test("bounded summary transported", async () => {
  const threadId = "thread-bounded";
  const sessionId = "session-bounded";
  clearMemoryEntry(threadId, sessionId);

  for (let index = 0; index < 6; index += 1) {
    storeDelegatedResult(
      makeEntry({
        task_id: `task-${index + 1}`,
        thread_id: threadId,
        session_id: sessionId,
        timestamp: Date.now() - index * 60_000,
        task: `Task ${index + 1}`,
        output:
          "This is a long output fragment that should stay bounded when rendered into the continuity summary transport field.",
      })
    );
  }

  const summary = getContinuitySummary(threadId, sessionId);
  assert.ok(summary);
  assert.equal(summary.length <= 700, true);

  const adapter = new SubprocessRouterAdapter({
    routerCommand: `node ${ensureResponderScript()}`,
    routerConfigPath: "/tmp/test.yaml",
    healthCacheTtlMs: 0,
  });

  const result = await adapter.execute({
    task: "Bounded summary task",
    taskId: "task-bounded",
    scopeId: "scope-bounded",
    threadId,
    sessionId,
    prompt: "Bounded summary prompt",
    continuitySummary: summary,
  });

  const payload = parsePayload(result.output);
  assert.equal(payload.continuity_summary, summary);
  assert.equal(payload.continuity_summary.length <= 700, true);
});
