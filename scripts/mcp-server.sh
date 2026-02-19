#!/usr/bin/env bash
# Wrapper to launch the Mission Control MCP stdio server with the correct
# Node version and pnpm. Used by Claude Code's mcpServers config so that
# leader agents and any other Claude Code session in this project have
# access to TeamCreate / TeamDelete / SendMessage tools.

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
  nvm use 22 2>/dev/null || true
fi

export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"

cd "$(dirname "$0")/.."
exec pnpm mcp
