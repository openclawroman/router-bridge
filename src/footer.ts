/**
 * Footer formatting for router-bridge execution results.
 * Appends metadata (tool, backend, model, timing, cost) to messages
 * that went through the routing pipeline.
 */

export interface FooterResult {
  tool?: string;
  backend?: string;
  model?: string;
  durationMs?: number;
  costEstimateUsd?: number | null;
}

const TOOL_LABELS: Record<string, string> = {
  codex_cli: "Codex CLI",
  claude_code: "Claude Code",
  openrouter_api: "OpenRouter API",
};

const BACKEND_LABELS: Record<string, string> = {
  openai_native: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

const MODEL_LABELS: Record<string, string> = {
  codex_primary: "o3-mini",
  codex_secondary: "o3",
  openrouter_minimax: "MiniMax",
  openrouter_kimi: "Kimi K2",
  claude_primary: "Claude 4 Sonnet",
};

export function formatFooter(result: FooterResult): string {
  const toolLabel = TOOL_LABELS[result.tool!] || result.tool;
  const backendLabel = BACKEND_LABELS[result.backend!] || result.backend;
  const modelLabel = MODEL_LABELS[result.model!] || result.model;

  const parts = [toolLabel, backendLabel, modelLabel].filter(Boolean);
  const meta: string[] = [];

  if (result.durationMs) meta.push(`${(result.durationMs / 1000).toFixed(1)}s`);
  if (result.costEstimateUsd && result.costEstimateUsd > 0)
    meta.push(`$${result.costEstimateUsd.toFixed(4)}`);

  if (parts.length > 0) {
    return `\n\n🔧 ${parts.join(" · ")}${meta.length ? " · " + meta.join(" · ") : ""}`;
  }
  return `\n\n🔧 router${meta.length ? " · " + meta.join(" · ") : ""}`;
}

export function stripExistingFooter(output: string): string {
  return output.replace(/\n\n🔧[^\n]*$/, "").trimEnd();
}

export function appendFooter(output: string, result: FooterResult): string {
  const clean = stripExistingFooter(output);
  return clean + formatFooter(result);
}
