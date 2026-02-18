import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import type { WakeRequest, WakeResponse } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function safeName(name: string): string {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

// POST /api/teams/[name]/wake — send a wake-up message to a team's inbox
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const safe = safeName(name);

    const team = readTeamConfig(safe);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = (await req.json().catch(() => ({}))) as WakeRequest;

    const inboxDir = path.join(CLAUDE_DIR, "teams", safe, "inbox");
    fs.mkdirSync(inboxDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const content = body.message
      ?? "You have pending tasks. Please check your task list with TaskList.";

    const message = {
      type: "message",
      sender: "mission-control",
      recipient: "team-lead",
      content,
      timestamp,
    };

    const filename = `wake-${Date.now()}.json`;
    fs.writeFileSync(
      path.join(inboxDir, filename),
      JSON.stringify(message, null, 2),
      "utf-8"
    );

    const response: WakeResponse = {
      teamName: safe,
      woken: true,
      message: content,
    };

    return ok(response);
  } catch (e) {
    return serverError(e);
  }
}
