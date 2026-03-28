import { describe, it, expect } from "vitest";
import { formatFooter, stripExistingFooter, appendFooter } from "../src/footer";
import type { FooterResult } from "../src/footer";

describe("footer formatting", () => {
  // ─── formatFooter ───────────────────────────────────────────────

  describe("formatFooter", () => {
    it("renders full footer with tool, backend, model, timing, and cost", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        model: "codex_primary",
        durationMs: 14825,
        costEstimateUsd: 0.0042,
      };
      const footer = formatFooter(result);
      expect(footer).toBe("\n\n🔧 Codex CLI · OpenAI · o3-mini · 14.8s · $0.0042");
    });

    it("renders footer with model_name (human-readable) when not in MODEL_LABELS", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        model: "gpt-5.4",
        durationMs: 12345,
      };
      const footer = formatFooter(result);
      expect(footer).toContain("gpt-5.4");
      expect(footer).toContain("Codex CLI");
      expect(footer).toContain("OpenAI");
      expect(footer).toContain("12.3s");
    });

    it("renders footer without cost when zero or missing", () => {
      const result: FooterResult = {
        tool: "claude_code",
        backend: "anthropic",
        model: "claude_primary",
        durationMs: 5000,
        costEstimateUsd: 0,
      };
      const footer = formatFooter(result);
      expect(footer).toBe("\n\n🔧 Claude Code · Anthropic · Claude 4 Sonnet · 5.0s");
      expect(footer).not.toContain("$");
    });

    it("renders footer without timing when durationMs is missing", () => {
      const result: FooterResult = {
        tool: "openrouter_api",
        backend: "openrouter",
        model: "openrouter_kimi",
      };
      const footer = formatFooter(result);
      expect(footer).toBe("\n\n🔧 OpenRouter API · OpenRouter · Kimi K2");
      expect(footer).not.toContain("s");
    });

    it("renders fallback footer when no tool/backend/model known", () => {
      const result: FooterResult = {
        durationMs: 3000,
        costEstimateUsd: 0.001,
      };
      const footer = formatFooter(result);
      expect(footer).toBe("\n\n🔧 router · 3.0s · $0.0010");
    });

    it("renders minimal fallback footer with no data", () => {
      const footer = formatFooter({});
      expect(footer).toBe("\n\n🔧 router");
    });

    it("maps all known codex tools correctly", () => {
      expect(formatFooter({ tool: "codex_cli", backend: "openai_native", model: "codex_primary" }))
        .toContain("Codex CLI");
      expect(formatFooter({ tool: "codex_cli", backend: "openai_native", model: "codex_secondary" }))
        .toContain("o3");
    });

    it("maps all known backends correctly", () => {
      expect(formatFooter({ tool: "codex_cli", backend: "openai_native" })).toContain("OpenAI");
      expect(formatFooter({ tool: "claude_code", backend: "anthropic" })).toContain("Anthropic");
      expect(formatFooter({ tool: "openrouter_api", backend: "openrouter" })).toContain("OpenRouter");
    });

    it("falls through to raw value for unknown tool/backend/model", () => {
      const result: FooterResult = {
        tool: "custom_tool",
        backend: "custom_backend",
        model: "custom_model",
      };
      const footer = formatFooter(result);
      expect(footer).toContain("custom_tool");
      expect(footer).toContain("custom_backend");
      expect(footer).toContain("custom_model");
    });

    it("filters out falsy values from parts", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        durationMs: 1000,
      };
      const footer = formatFooter(result);
      expect(footer).toContain("Codex CLI");
      expect(footer).not.toContain(" · undefined");
      expect(footer).toContain("1.0s");
    });

    it("formats cost with exactly 4 decimal places", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        costEstimateUsd: 0.1,
      };
      const footer = formatFooter(result);
      expect(footer).toContain("$0.1000");
    });

    it("formats sub-second durations", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        durationMs: 750,
      };
      const footer = formatFooter(result);
      expect(footer).toContain("0.8s"); // (750/1000).toFixed(1) = 0.8
    });
  });

  // ─── stripExistingFooter ────────────────────────────────────────

  describe("stripExistingFooter", () => {
    it("strips an existing 🔧 footer from output", () => {
      const input = "Some code output\n\n🔧 via codex_primary · 14825ms";
      expect(stripExistingFooter(input)).toBe("Some code output");
    });

    it("strips the full router-bridge footer", () => {
      const input = "Hello, World!\n\n🔧 Codex CLI · OpenAI · o3-mini · 14.8s · $0.0042";
      expect(stripExistingFooter(input)).toBe("Hello, World!");
    });

    it("does not strip content when no footer present", () => {
      const input = "Just plain output without footer";
      expect(stripExistingFooter(input)).toBe("Just plain output without footer");
    });

    it("strips only the last footer occurrence", () => {
      const input = "Output with 🔧 emoji in text\n\n🔧 actual footer";
      expect(stripExistingFooter(input)).toBe("Output with 🔧 emoji in text");
    });

    it("handles empty string", () => {
      expect(stripExistingFooter("")).toBe("");
    });
  });

  // ─── appendFooter ───────────────────────────────────────────────

  describe("appendFooter", () => {
    it("appends footer to clean output", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        model: "codex_primary",
        durationMs: 14825,
        costEstimateUsd: 0.0042,
      };
      const output = appendFooter("Hello, World!", result);
      expect(output).toBe("Hello, World!\n\n🔧 Codex CLI · OpenAI · o3-mini · 14.8s · $0.0042");
    });

    it("replaces existing footer with new one", () => {
      const input = "Code output\n\n🔧 via codex_primary · 14825ms";
      const result: FooterResult = {
        tool: "claude_code",
        backend: "anthropic",
        model: "claude_primary",
        durationMs: 5000,
      };
      const output = appendFooter(input, result);
      expect(output).toBe("Code output\n\n🔧 Claude Code · Anthropic · Claude 4 Sonnet · 5.0s");
    });

    it("does not add double footers", () => {
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        model: "codex_primary",
        durationMs: 1000,
      };
      const first = appendFooter("Output", result);
      const second = appendFooter(first, result);
      // Should have exactly one footer (strip + re-add)
      const footerCount = (second.match(/🔧/g) || []).length;
      expect(footerCount).toBe(1);
    });
  });

  // ─── Integration: model_name from router output ─────────────────

  describe("model_name integration", () => {
    it("displays model_name (gpt-5.4) instead of model_profile (codex_primary)", () => {
      // Simulates subprocess adapter: model = parsed.model_name ?? parsed.model_profile
      // When router sends model_name, it should be preferred
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        model: "gpt-5.4", // model_name from router output
        durationMs: 21400,
      };
      const footer = formatFooter(result);
      expect(footer).toContain("gpt-5.4");
      expect(footer).not.toContain("codex_primary");
      expect(footer).toContain("21.4s");
    });

    it("displays model_profile when model_name is not available", () => {
      // Simulates fallback: no model_name, use model_profile
      const result: FooterResult = {
        tool: "codex_cli",
        backend: "openai_native",
        model: "codex_primary", // model_profile lookup → o3-mini
        durationMs: 21400,
      };
      const footer = formatFooter(result);
      expect(footer).toContain("o3-mini");
      expect(footer).not.toContain("codex_primary");
    });
  });
});
