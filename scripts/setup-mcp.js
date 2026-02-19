#!/usr/bin/env node
/**
 * Postinstall: patches .claude/settings.json with an absolute path to the
 * MCP server wrapper for this machine. Runs automatically via `pnpm install`.
 *
 * Safe to run multiple times — only updates the mcpServers key, preserving
 * all other settings (permissions, teammateMode, etc.).
 */

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const SETTINGS_PATH = path.join(PROJECT_DIR, ".claude", "settings.json");
const MCP_SCRIPT = path.join(PROJECT_DIR, "scripts", "mcp-server.sh");

// Determine the correct bash executable
const BASH =
  process.platform === "win32"
    ? "bash" // WSL / Git Bash — user must have bash in PATH
    : "/bin/bash";

// Read existing settings (if any), merge mcpServers, write back
let settings = {};
try {
  const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
  settings = JSON.parse(raw);
} catch {
  // File missing or malformed — start fresh
}

settings.mcpServers = {
  "mission-control": {
    command: BASH,
    args: [MCP_SCRIPT],
  },
};

fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");

console.log("✓ MCP server registered at:", MCP_SCRIPT);
