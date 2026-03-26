import { handleRouterOn, handleRouterOff, handleRouterStatus } from "./commands";
import type { PluginConfig } from "./types";

export interface SkillMatch {
  matched: boolean;
  action: "on" | "off" | "status" | null;
  confidence: number;
  matchedPattern: string;
}

const ENABLE_PATTERNS = [
  /switch to external routing/i,
  /use router (here|in this)/i,
  /enable router/i,
  /turn on router/i,
  /route through router/i,
  /activate router backend/i,
];

const DISABLE_PATTERNS = [
  /turn off router/i,
  /disable router/i,
  /use native (routing|backend)/i,
  /switch to native/i,
  /stop using router/i,
  /deactivate router backend/i,
];

const STATUS_PATTERNS = [
  /router status/i,
  /what'?s my router/i,
  /is router (on|off)/i,
  /show router/i,
  /what backend/i,
];

export function matchRouterIntent(input: string): SkillMatch {
  for (const pattern of ENABLE_PATTERNS) {
    if (pattern.test(input)) {
      return { matched: true, action: "on", confidence: 0.9, matchedPattern: pattern.source };
    }
  }
  for (const pattern of DISABLE_PATTERNS) {
    if (pattern.test(input)) {
      return { matched: true, action: "off", confidence: 0.9, matchedPattern: pattern.source };
    }
  }
  for (const pattern of STATUS_PATTERNS) {
    if (pattern.test(input)) {
      return { matched: true, action: "status", confidence: 0.9, matchedPattern: pattern.source };
    }
  }
  return { matched: false, action: null, confidence: 0, matchedPattern: "" };
}

/**
 * Handle a natural-language router request by delegating to the same
 * command handlers that /router on|off|status uses.
 */
export async function handleRouterIntent(input: string, ctx: any, config: PluginConfig): Promise<{ text: string } | null> {
  const match = matchRouterIntent(input);
  if (!match.matched || !match.action) return null;

  switch (match.action) {
    case "on":
      return handleRouterOn(ctx, config);
    case "off":
      return handleRouterOff(ctx, config);
    case "status":
      return handleRouterStatus(ctx, config);
  }
}
