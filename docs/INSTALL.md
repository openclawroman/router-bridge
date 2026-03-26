# Installation Layout

## Canonical Path Structure

```
~/.openclaw/router/
├── bin/
│   └── ai-code-runner          # openclaw-router entrypoint
├── config/
│   └── router.config.json      # openclaw-router config
├── runtime/
│   ├── bridge/
│   │   └── .router-state.json  # router-bridge scoped state
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
