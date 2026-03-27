#!/bin/sh
# ── fake-executors.sh ─────────────────────────────────────────────────
# Source this file to create fake codex + claude CLI shims in a given
# bin directory.  Usage:
#
#   . tests/fixtures/fake-executors.sh /path/to/tmp/bin
#
# The fake CLIs match the argument conventions the real openclaw-router
# expects (codex [--model X] SUMMARY, claude -p SUMMARY) and print a
# deterministic success string to stdout before exiting 0.
# ──────────────────────────────────────────────────────────────────────

FAKE_BIN_DIR="${1:?Usage: . fake-executors.sh <bin-dir>}"
mkdir -p "$FAKE_BIN_DIR"

# ── Fake codex ────────────────────────────────────────────────────────
cat > "$FAKE_BIN_DIR/codex" <<'CODEX_SH'
#!/bin/sh
# Fake codex CLI — accepts any args, prints success to stdout
echo "Token refresh flow implemented by fake codex"
exit 0
CODEX_SH
chmod +x "$FAKE_BIN_DIR/codex"

# ── Fake claude ───────────────────────────────────────────────────────
cat > "$FAKE_BIN_DIR/claude" <<'CLAUDE_SH'
#!/bin/sh
# Fake claude CLI — accepts any args, prints success to stdout
echo "Task completed by fake claude"
exit 0
CLAUDE_SH
chmod +x "$FAKE_BIN_DIR/claude"
