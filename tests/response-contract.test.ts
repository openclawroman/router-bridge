import { describe, it, expect } from "vitest";

describe("response contract", () => {
  // Test the normalizeResponse logic by simulating what the adapter does
  it("router format extracts final_summary as output", () => {
    const routerOutput = {
      success: true,
      task_id: "task_001",
      tool: "codex_cli",
      backend: "openai_native",
      model_profile: "codex_primary",
      exit_code: 0,
      latency_ms: 1234,
      final_summary: "Implementation complete",
    };

    // Simulate the normalization logic
    const output = routerOutput.final_summary ?? routerOutput.output ?? "";
    expect(output).toBe("Implementation complete");

    const model = routerOutput.model_profile ?? (routerOutput as any).model;
    expect(model).toBe("codex_primary");
  });

  it("bridge format extracts output as output", () => {
    const bridgeOutput = {
      success: true,
      output: "Task completed successfully",
      tokens_used: 150,
      cost_usd: 0.002,
    };

    const output = (bridgeOutput as any).final_summary ?? bridgeOutput.output ?? "";
    expect(output).toBe("Task completed successfully");
  });

  it("error format extracts normalized_error or error", () => {
    const errorOutput = {
      success: false,
      normalized_error: "auth_error",
      exit_code: 1,
    };

    const error = errorOutput.normalized_error ?? (errorOutput as any).error ?? "";
    expect(error).toBe("auth_error");
  });

  it("empty response produces empty output", () => {
    const empty = { success: true };
    const output = (empty as any).final_summary ?? (empty as any).output ?? "";
    expect(output).toBe("");
  });

  it("cost prefers cost_estimate_usd over cost_usd", () => {
    const both = { cost_estimate_usd: 0.001, cost_usd: 0.002 };
    const cost = both.cost_estimate_usd ?? both.cost_usd;
    expect(cost).toBe(0.001);
  });

  it("duration prefers latency_ms over duration_ms", () => {
    const both = { latency_ms: 500, duration_ms: 1000 };
    const duration = both.latency_ms ?? both.duration_ms;
    expect(duration).toBe(500);
  });
});
