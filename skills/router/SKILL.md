# Router Bridge Skill

Maps natural-language requests about router/backend control to `handleRouterOn()`, `handleRouterOff()`, and `handleRouterStatus()` in `src/commands.ts` — the same handlers that `/router on|off|status` call.

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

## Rules

- Do NOT activate for general coding questions
- Always delegate to handlers — no inline state changes
- Auto-reply when matched (no model call needed)
