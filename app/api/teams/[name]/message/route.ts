import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, err, serverError, safeName } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function inboxPath(teamName: string, agentName: string): string {
  return path.join(CLAUDE_DIR, "teams", teamName, "inboxes", `${agentName}.json`);
}

// POST /api/teams/[name]/message — send a message to a teammate
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = await req.json() as {
      recipient?: string;
      content?: string;
      sender?: string;
    };

    if (!body.recipient || typeof body.recipient !== "string") {
      return err("recipient is required", "VALIDATION_ERROR");
    }
    if (!body.content || typeof body.content !== "string") {
      return err("content is required", "VALIDATION_ERROR");
    }

    // Validate recipient is a team member
    const member = team.members.find((m) => m.name === body.recipient);
    if (!member) {
      return notFound(`Teammate "${body.recipient}" not found in team "${name}"`);
    }

    const message = {
      id: `msg-${Date.now()}`,
      from: body.sender ?? "dashboard",
      to: body.recipient,
      content: body.content,
      timestamp: new Date().toISOString(),
    };

    // Write message to teammate's inbox
    const inbox = path.resolve(inboxPath(name, body.recipient));
    const resolvedClaudeDir = path.resolve(CLAUDE_DIR);
    if (!inbox.startsWith(resolvedClaudeDir + path.sep)) {
      return err("Path traversal blocked", "SECURITY_ERROR", 403);
    }
    const dir = path.dirname(inbox);
    fs.mkdirSync(dir, { recursive: true });

    let messages: typeof message[] = [];
    if (fs.existsSync(inbox)) {
      try {
        messages = JSON.parse(fs.readFileSync(inbox, "utf-8")) as typeof message[];
      } catch { /* start fresh */ }
    }
    messages.push(message);
    fs.writeFileSync(inbox, JSON.stringify(messages, null, 2), "utf-8");

    return ok(message);
  } catch (e) {
    return serverError(e);
  }
}
