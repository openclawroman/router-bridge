# Installation Layout

## Prerequisites

### Codex CLI (required for openai_native backend)

```bash
# Install
npm install -g @openai/codex

# Authenticate — opens browser for OpenAI OAuth
codex login

# Verify
codex --version
codex exec "say hello"
```

After `codex login`, auth is stored in `~/.codex/config` (or `~/.codex/auth.json`). The router detects this automatically.

### Claude Code CLI (optional, for anthropic backend)

```bash
# Install
npm install -g @anthropic-ai/claude-code

# Authenticate
claude login

# Verify
claude --version
```

Without Claude, the router falls through `claude_backup` state and uses OpenRouter as fallback.

### API Keys (optional, for OpenRouter backend)

Set in `~/.openclaw/router/env/router.env`:
```
OPENROUTER_API_KEY=sk-or-...
```

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/openclawroman/router-bridge/main/scripts/install_router_stack.sh | bash
```

Or clone and run locally:

```bash
git clone https://github.com/openclawroman/router-bridge.git
cd router-bridge && ./scripts/install_router_stack.sh
```

The script is idempotent — safe to run multiple times. It creates the directory structure, clones/updates openclaw-router, creates symlinks, generates an env template if missing, and runs a health check.

## Canonical Path Structure

```
~/.openclaw/router/
├── bin/
│   └── ai-code-runner          # openclaw-router entrypoint
├── config/
│   └── router.config.json      # openclaw-router config
├── runtime/
│   ├── bridge/
│   │   └── state.json  # router-bridge scoped state
│   └── router/
│       ├── provider_state.json # router execution state
│       └── routing.log.jsonl   # router structured logs
├── schemas/
│   ├── router_request.schema.json
│   └── router_response.schema.json
├── env/
│   └── router.env              # service environment file
└── runner/
    └── openclaw-router/        # cloned openclaw-router repo
```

## Default Config

router-bridge uses these defaults:
- `routerCommand`: `python3 ~/.openclaw/router/bin/ai-code-runner`
- `routerConfigPath`: `~/.openclaw/router/config/router.config.json`

Users can override these in their OpenClaw plugin config.

## Installation Steps

1. Clone openclaw-router into the runner directory:
   ```bash
   mkdir -p ~/.openclaw/router/runner
   git clone https://github.com/openclawroman/openclaw-router.git ~/.openclaw/router/runner/openclaw-router
   ```

2. Create directory structure:
   ```bash
   mkdir -p ~/.openclaw/router/bin ~/.openclaw/router/config ~/.openclaw/router/env
   ```

3. Install the wrapper script:
   ```bash
   cp bin/ai-code-runner ~/.openclaw/router/bin/
   chmod +x ~/.openclaw/router/bin/ai-code-runner
   ```

4. Create symlinks:
   ```bash
   ln -sf ~/.openclaw/router/runner/openclaw-router/config/router.config.json ~/.openclaw/router/config/router.config.json
   ```

5. Create environment file:
   ```bash
   cp env/router.env ~/.openclaw/router/env/router.env
   # Edit the file to add your API keys
   ```

6. Verify installation:
   ```bash
   ~/.openclaw/router/bin/ai-code-runner --health
   ```

## Upgrades

To upgrade openclaw-router:
```bash
cd ~/.openclaw/router/runner/openclaw-router && git pull
```

Config is not overwritten during upgrades.
