/**
 * MCP stdio server exposing team coordination tools for Claude Code leader agents.
 *
 * Tools:
 *   - TeamCreate: create ~/.claude/teams/{name}/ and ~/.claude/tasks/{name}/
 *   - TeamDelete: remove those directories
 *   - SendMessage: append to ~/.claude/teams/{name}/inboxes/{recipient}.json
 *
 * Run with: tsx --tsconfig tsconfig.server.json server/mcp-server.ts
 */

import fs from "fs";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// ── Security helpers ───────────────────────────────────────────────────────────

function safeName(name: string): string {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: "${name}" — only alphanumeric, dash, underscore allowed`);
  }
  return name;
}

function assertSafePath(resolvedPath: string): void {
  const resolved = path.resolve(resolvedPath);
  const base = path.resolve(CLAUDE_DIR);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal attempt blocked: ${resolvedPath}`);
  }
}

// ── Tool implementations ───────────────────────────────────────────────────────

function teamCreate(teamName: string): object {
  const safe = safeName(teamName);
  const teamDir = path.join(CLAUDE_DIR, "teams", safe);
  const tasksDir = path.join(CLAUDE_DIR, "tasks", safe);

  assertSafePath(teamDir);
  assertSafePath(tasksDir);

  const configPath = path.join(teamDir, "config.json");

  // Idempotent: don't overwrite if already exists
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(teamDir, { recursive: true });
    const config = {
      name: safe,
      description: "",
      members: [],
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } else {
    // Ensure teamDir exists (in case partial state)
    fs.mkdirSync(teamDir, { recursive: true });
  }

  fs.mkdirSync(tasksDir, { recursive: true });

  return {
    success: true,
    teamName: safe,
    teamDir,
    tasksDir,
  };
}

function teamDelete(teamName: string): object {
  const safe = safeName(teamName);
  const teamDir = path.join(CLAUDE_DIR, "teams", safe);
  const tasksDir = path.join(CLAUDE_DIR, "tasks", safe);

  assertSafePath(teamDir);
  assertSafePath(tasksDir);

  const cleaned: string[] = [];

  if (fs.existsSync(teamDir)) {
    fs.rmSync(teamDir, { recursive: true, force: true });
    cleaned.push(teamDir);
  }

  if (fs.existsSync(tasksDir)) {
    fs.rmSync(tasksDir, { recursive: true, force: true });
    cleaned.push(tasksDir);
  }

  return {
    success: true,
    cleaned,
  };
}

function sendMessage(
  teamName: string,
  recipient: string,
  content: string,
  sender?: string
): object {
  const safeTeam = safeName(teamName);
  const safeRecipient = safeName(recipient);

  const inboxDir = path.join(CLAUDE_DIR, "teams", safeTeam, "inboxes");
  const inboxPath = path.join(inboxDir, `${safeRecipient}.json`);

  assertSafePath(inboxDir);
  assertSafePath(inboxPath);

  fs.mkdirSync(inboxDir, { recursive: true });

  // Read existing messages
  let messages: object[] = [];
  if (fs.existsSync(inboxPath)) {
    try {
      const raw = fs.readFileSync(inboxPath, "utf-8");
      const parsed = JSON.parse(raw);
      messages = Array.isArray(parsed) ? parsed : [];
    } catch {
      messages = [];
    }
  }

  const message = {
    id: `msg-${Date.now()}`,
    from: sender ?? "leader",
    to: safeRecipient,
    content,
    timestamp: new Date().toISOString(),
  };

  messages.push(message);
  fs.writeFileSync(inboxPath, JSON.stringify(messages, null, 2), "utf-8");

  return {
    success: true,
    message,
  };
}

// ── MCP Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "mission-control", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "TeamCreate",
      description:
        "Create team directories (~/.claude/teams/{name}/ and ~/.claude/tasks/{name}/) and initialize config.json. Idempotent — safe to call even if the team already exists.",
      inputSchema: {
        type: "object",
        properties: {
          team_name: {
            type: "string",
            description: "Team name (alphanumeric, dash, underscore only)",
          },
        },
        required: ["team_name"],
      },
    },
    {
      name: "TeamDelete",
      description:
        "Remove team directories (~/.claude/teams/{name}/ and ~/.claude/tasks/{name}/) recursively. Used for cleanup when a team completes or is abandoned.",
      inputSchema: {
        type: "object",
        properties: {
          team_name: {
            type: "string",
            description: "Team name to delete",
          },
        },
        required: ["team_name"],
      },
    },
    {
      name: "SendMessage",
      description:
        "Send a message to a team member by appending to their inbox file (~/.claude/teams/{name}/inboxes/{recipient}.json).",
      inputSchema: {
        type: "object",
        properties: {
          team_name: {
            type: "string",
            description: "Team name",
          },
          recipient: {
            type: "string",
            description: "Recipient agent name",
          },
          content: {
            type: "string",
            description: "Message content",
          },
          sender: {
            type: "string",
            description: "Sender name (defaults to 'leader')",
          },
        },
        required: ["team_name", "recipient", "content"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: object;

    if (name === "TeamCreate") {
      const { team_name } = args as { team_name: string };
      result = teamCreate(team_name);
    } else if (name === "TeamDelete") {
      const { team_name } = args as { team_name: string };
      result = teamDelete(team_name);
    } else if (name === "SendMessage") {
      const { team_name, recipient, content, sender } = args as {
        team_name: string;
        recipient: string;
        content: string;
        sender?: string;
      };
      result = sendMessage(team_name, recipient, content, sender);
    } else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Mission Control MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
