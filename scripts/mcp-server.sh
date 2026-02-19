#!/usr/bin/env bash
# Mission Control MCP server launcher.
# Environment-agnostic: works on macOS and Linux with or without nvm/pnpm
# in the shell PATH. Absolute path injected at install time by scripts/setup-mcp.js.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── 1. Load Node via nvm if available (respects .nvmrc) ──────────────────────
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm use 2>/dev/null || nvm use 22 2>/dev/null || true
fi

# ── 2. Locate pnpm (macOS default, Linux default, PATH fallback, then tsx) ───
PNPM_CANDIDATES=(
  "$HOME/Library/pnpm/pnpm"           # macOS corepack / standalone install
  "$HOME/.local/share/pnpm/pnpm"      # Linux standalone install
)
# Also add PATH entry if pnpm is already available
if command -v pnpm &>/dev/null; then
  PNPM_CANDIDATES+=("$(command -v pnpm)")
fi

for candidate in "${PNPM_CANDIDATES[@]}"; do
  if [ -x "$candidate" ]; then
    exec "$candidate" --dir "$PROJECT_DIR" mcp
  fi
done

# ── 3. Last resort: invoke tsx directly via node ──────────────────────────────
TSX="$PROJECT_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "ERROR: pnpm not found and node_modules/.bin/tsx missing." >&2
  echo "Run 'pnpm install' first." >&2
  exit 1
fi
exec node "$TSX" \
  --tsconfig "$PROJECT_DIR/tsconfig.server.json" \
  "$PROJECT_DIR/server/mcp-server.ts"
