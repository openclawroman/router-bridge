# Router Bridge Skill

Maps natural-language requests about router/backend control to the
plugin's command handlers. This is a **thin semantic routing layer** —
it delegates to the same functions used by `/router on|off|status`.

## Trigger Patterns

**Enable router:**
- "switch to external routing layer in this thread"
- "use router here"
- "enable router"
- "turn on router"
- "route through router"
- "activate router backend"

**Disable router:**
- "turn off router in this chat"
- "disable router"
- "use native"
- "stop using router"
- "deactivate router backend"

**Check status:**
- "router status"
- "what's my router config"
- "is router on"
- "show router status"
- "what backend am I using"

## Handler Integration

The skill maps to `handleRouterOn()`, `handleRouterOff()`, and `handleRouterStatus()`
from `src/commands.ts`. These are the SAME functions that `/router on|off|status` call.

**Single source of truth:**
- `/router on` → `handleRouterOn(ctx, config)`
- Natural "use router here" → `handleRouterOn(ctx, config)`
- Both paths produce identical state changes and output.

## Rules

- Only act on explicit router/backend requests
- Do NOT activate for general coding questions
- Do NOT implement any state change logic — always delegate to handlers
- The skill is auto-reply when matched (no model call needed)
