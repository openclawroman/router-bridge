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

2. Create symlinks:
   ```bash
   mkdir -p ~/.openclaw/router/bin ~/.openclaw/router/config
   ln -sf ~/.openclaw/router/runner/openclaw-router/bin/ai-code-runner ~/.openclaw/router/bin/ai-code-runner
   ln -sf ~/.openclaw/router/runner/openclaw-router/config/router.config.json ~/.openclaw/router/config/router.config.json
   ```

3. Verify installation:
   ```bash
   python3 ~/.openclaw/router/bin/ai-code-runner --health
   ```

## Upgrades

To upgrade openclaw-router:
```bash
cd ~/.openclaw/router/runner/openclaw-router && git pull
```

Config is not overwritten during upgrades.
