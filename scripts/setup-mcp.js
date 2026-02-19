#!/usr/bin/env node
/**
 * Postinstall: generates .claude/settings.json from .claude/settings.base.json,
 * patching in the machine-specific absolute path to the MCP server wrapper.
 * Runs automatically via `pnpm install`.
 *
 * The base file (.claude/settings.base.json) is committed to git and contains
 * all portable settings (permissions, teammateMode).
 * The generated file (.claude/settings.json) is gitignored — it contains the
 * absolute path for this machine and should never be committed.
 *
 * Safe to run multiple times — always regenerates from the base file.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const BASE_PATH = path.join(PROJECT_DIR, ".claude", "settings.base.json");
const SETTINGS_PATH = path.join(PROJECT_DIR, ".claude", "settings.json");
const MCP_SCRIPT = path.join(PROJECT_DIR, "scripts", "mcp-server.sh");

// Determine the correct bash executable
const BASH =
  process.platform === "win32"
    ? "bash" // WSL / Git Bash — user must have bash in PATH
    : "/bin/bash";

// Load the base settings (source of truth in git)
let settings = {};
try {
  const raw = fs.readFileSync(BASE_PATH, "utf-8");
  settings = JSON.parse(raw);
} catch {
  // Base file missing — fall back to reading existing settings.json
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    settings = JSON.parse(raw);
  } catch {
    // No existing settings — start fresh
  }
}

// Inject the machine-specific MCP server path
settings.mcpServers = {
  "mission-control": {
    command: BASH,
    args: [MCP_SCRIPT],
  },
};

fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");

console.log("✓ MCP server registered at:", MCP_SCRIPT);
