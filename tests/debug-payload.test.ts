import { describe, it, expect } from "vitest";
import { SubprocessRouterAdapter } from "../src/adapters";
import * as path from "path";

const CAT_STDIN = path.join(__dirname, "cat_stdin.sh");

describe("debug payload", () => {
  it("logs actual payload", async () => {
    const adapter = new SubprocessRouterAdapter({
      routerCommand: CAT_STDIN,
      routerConfigPath: "/tmp/test.yaml",
      healthCacheTtlMs: 0,
    });
    const result = await adapter.execute({
      task: "write code",
      taskId: "task-42",
      scopeId: "s-1",
      taskMeta: { type: "coding" },
    });
    const payload = JSON.parse(result.output);
    console.log("TASK_META:", JSON.stringify(payload.task_meta, null, 2));
    expect(true).toBe(true);
  });
});
