import { NextRequest, NextResponse } from "next/server";
import { listTeams, readTaskList, getTeamLastActivity } from "@/lib/claude-files";
import { ok, err, serverError } from "@/lib/api-helpers";
import type { TeamHealthStatus } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const STALENESS_MS = 5 * 60 * 1000;

// GET /api/teams — list all teams from ~/.claude/teams/
export async function GET(): Promise<NextResponse> {
  try {
    const teams = listTeams().map((t) => {
      const lastActivity = getTeamLastActivity(t.name);
      let status: TeamHealthStatus = "asleep";
      if (lastActivity) {
        const elapsed = Date.now() - new Date(lastActivity).getTime();
        status = elapsed < STALENESS_MS ? "alive" : "asleep";
      }

      // Count stale in-progress tasks
      const tasks = readTaskList(t.name);
      const tasksBasePath = path.join(CLAUDE_DIR, "tasks", t.name);
      let staleTaskCount = 0;
      for (const task of tasks) {
        if (task.status !== "in_progress") continue;
        try {
          const taskFile = path.join(tasksBasePath, `${task.id}.json`);
          const stat = fs.statSync(taskFile);
          if (Date.now() - stat.mtimeMs > STALENESS_MS) {
            staleTaskCount++;
          }
        } catch {
          // skip
        }
      }

      return {
        ...t,
        members: t.members ?? [],
        health: { status, lastActivity, staleTaskCount },
      };
    });
    return ok(teams, { count: teams.length });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/teams — create a new team config
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { name?: string; description?: string };

    if (!body.name || typeof body.name !== "string") {
      return err("name is required", "VALIDATION_ERROR");
    }

    // Validate name: only alphanumeric, dash, underscore
    if (!/^[\w-]+$/.test(body.name)) {
      return err("name may only contain letters, numbers, dashes, and underscores", "VALIDATION_ERROR");
    }

    const teamDir = path.join(CLAUDE_DIR, "teams", body.name);
    const resolvedDir = path.resolve(teamDir);
    if (!resolvedDir.startsWith(path.resolve(CLAUDE_DIR))) {
      return err("Path traversal blocked", "SECURITY_ERROR", 403);
    }

    if (fs.existsSync(path.join(teamDir, "config.json"))) {
      return err(`Team "${body.name}" already exists`, "CONFLICT", 409);
    }

    const config = {
      name: body.name,
      description: body.description ?? "",
      members: [],
      createdAt: new Date().toISOString(),
    };

    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, "config.json"),
      JSON.stringify(config, null, 2),
      "utf-8"
    );

    return NextResponse.json({ data: config }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
