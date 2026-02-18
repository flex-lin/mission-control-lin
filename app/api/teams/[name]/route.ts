import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig, readTaskList } from "@/lib/claude-files";
import { ok, notFound, err, serverError } from "@/lib/api-helpers";
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

// DELETE /api/teams/[name]?mode=archive|delete — archive or permanently delete a team
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const safe = safeName(name);
    const mode = req.nextUrl.searchParams.get("mode") ?? "archive";

    const teamDir = path.join(CLAUDE_DIR, "teams", safe);
    const tasksDir = path.join(CLAUDE_DIR, "tasks", safe);

    if (!fs.existsSync(path.join(teamDir, "config.json"))) {
      return notFound(`Team "${name}" not found`);
    }

    if (mode === "archive") {
      // Move team to archive directory
      const archiveTeamDir = path.join(CLAUDE_DIR, "teams-archive", safe);
      const archiveTasksDir = path.join(CLAUDE_DIR, "tasks-archive", safe);

      // Add archivedAt timestamp to config
      const configPath = path.join(teamDir, "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      config.archivedAt = new Date().toISOString();

      fs.mkdirSync(path.dirname(archiveTeamDir), { recursive: true });
      if (fs.existsSync(archiveTeamDir)) {
        fs.rmSync(archiveTeamDir, { recursive: true });
      }
      fs.renameSync(teamDir, archiveTeamDir);
      fs.writeFileSync(
        path.join(archiveTeamDir, "config.json"),
        JSON.stringify(config, null, 2),
        "utf-8"
      );

      // Archive tasks too
      if (fs.existsSync(tasksDir)) {
        fs.mkdirSync(path.dirname(archiveTasksDir), { recursive: true });
        if (fs.existsSync(archiveTasksDir)) {
          fs.rmSync(archiveTasksDir, { recursive: true });
        }
        fs.renameSync(tasksDir, archiveTasksDir);
      }

      return ok({ name: safe, action: "archived" });
    } else if (mode === "delete") {
      // Permanently delete
      if (fs.existsSync(teamDir)) {
        fs.rmSync(teamDir, { recursive: true });
      }
      if (fs.existsSync(tasksDir)) {
        fs.rmSync(tasksDir, { recursive: true });
      }
      return ok({ name: safe, action: "deleted" });
    } else {
      return err("mode must be 'archive' or 'delete'", "VALIDATION_ERROR");
    }
  } catch (e) {
    return serverError(e);
  }
}
