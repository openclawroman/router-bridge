# Router Bridge Skill

When the user asks to route coding tasks through the router, or wants to 
enable/disable the router backend, map to the appropriate /router command.

## Triggers
- "enable router" / "turn on router" / "route through router" → /router on
- "disable router" / "turn off router" / "use native" → /router off
- "router status" / "what's my router config" / "is router on" → /router status

## Rules
- Only act on explicit router/backend requests
- Do NOT activate for general coding questions
- The /router command is an auto-reply (no model call needed)
