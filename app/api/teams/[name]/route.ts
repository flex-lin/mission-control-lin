import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig, readTaskList } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function safeName(name: string): string {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

// GET /api/teams/[name] — team detail with members and tasks
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const tasks = readTaskList(name);
    return ok({ ...team, tasks });
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/teams/[name] — permanently delete a team
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const safe = safeName(name);

    const teamDir = path.join(CLAUDE_DIR, "teams", safe);
    const tasksDir = path.join(CLAUDE_DIR, "tasks", safe);

    if (!fs.existsSync(path.join(teamDir, "config.json"))) {
      return notFound(`Team "${name}" not found`);
    }

    if (fs.existsSync(teamDir)) {
      fs.rmSync(teamDir, { recursive: true });
    }
    if (fs.existsSync(tasksDir)) {
      fs.rmSync(tasksDir, { recursive: true });
    }
    return ok({ name: safe, action: "deleted" });
  } catch (e) {
    return serverError(e);
  }
}
