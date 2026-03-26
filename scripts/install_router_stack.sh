#!/usr/bin/env bash
set -euo pipefail

ROUTER_ROOT="${OPENCLAW_ROUTER_ROOT:-$HOME/.openclaw/router}"

echo "🔧 Installing router stack to $ROUTER_ROOT..."

# ── Create directory structure ──────────────────────────────────────
mkdir -p "$ROUTER_ROOT"/{bin,config,runtime/bridge,runtime/router,schemas,env,runner}

# ── Clone or update openclaw-router ────────────────────────────────
if [ -d "$ROUTER_ROOT/runner/openclaw-router/.git" ]; then
  echo "📦 Updating openclaw-router..."
  cd "$ROUTER_ROOT/runner/openclaw-router"
  git pull --ff-only || echo "⚠️ Could not pull — local changes may exist"
else
  echo "📦 Cloning openclaw-router..."
  git clone https://github.com/openclawroman/openclaw-router.git "$ROUTER_ROOT/runner/openclaw-router"
fi

# ── Create symlinks ────────────────────────────────────────────────
ln -sf "$ROUTER_ROOT/runner/openclaw-router/bin/ai-code-runner" "$ROUTER_ROOT/bin/ai-code-runner"
ln -sf "$ROUTER_ROOT/runner/openclaw-router/config/router.config.json" "$ROUTER_ROOT/config/router.config.json"

# ── Copy wrapper if it exists in plugin dir ────────────────────────
PLUGIN_DIR="${OPENCLAW_PLUGIN_DIR:-}"
if [ -n "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/bin/ai-code-runner-wrapper" ]; then
  cp "$PLUGIN_DIR/bin/ai-code-runner-wrapper" "$ROUTER_ROOT/bin/ai-code-runner"
  chmod +x "$ROUTER_ROOT/bin/ai-code-runner"
fi

# ── Generate env file if missing ───────────────────────────────────
if [ ! -f "$ROUTER_ROOT/env/router.env" ]; then
  cat > "$ROUTER_ROOT/env/router.env" << 'ENV'
# Router environment — secrets loaded by wrapper script
# Set your API keys here. Never commit this file.
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=
ENV
  echo "📝 Created env template at $ROUTER_ROOT/env/router.env"
fi

# ── Run doctor (if router-bridge is installed) ─────────────────────
if command -v node &>/dev/null && [ -f "$ROUTER_ROOT/bin/ai-code-runner" ]; then
  echo ""
  echo "🩺 Running health checks..."
  echo "  ✅ python3: $(python3 --version 2>/dev/null || echo 'NOT FOUND')"
  echo "  ✅ node: $(node --version)"
  echo "  $([ -f "$ROUTER_ROOT/bin/ai-code-runner" ] && echo '✅' || echo '❌') router binary"
  echo "  $([ -f "$ROUTER_ROOT/env/router.env" ] && echo '✅' || echo '❌') env file"
fi

# ── Print plugin config ────────────────────────────────────────────
echo ""
echo "✅ Installation complete!"
echo ""
echo "Add to your OpenClaw plugin config:"
echo '  "router-bridge": {'
echo '    "routerCommand": "'"$ROUTER_ROOT"'/bin/ai-code-runner",'
echo '    "routerConfigPath": "'"$ROUTER_ROOT"'/config/router.config.json"'
echo '  }'
