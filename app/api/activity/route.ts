import { NextRequest, NextResponse } from "next/server";
import { ok, serverError } from "@/lib/api-helpers";
import type { ActivityEvent, ActivityEventType } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// Build activity events by reading recent changes in ~/.claude/
// - New tasks from ~/.claude/tasks/{team}/
// - Team changes from ~/.claude/teams/{team}/config.json
function buildActivityEvents(): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  // Scan task directories for recent task files
  const tasksDir = path.join(CLAUDE_DIR, "tasks");
  if (fs.existsSync(tasksDir)) {
    const teamDirs = fs.readdirSync(tasksDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const team of teamDirs) {
      const teamTasksDir = path.join(tasksDir, team);
      try {
        const taskFiles = fs.readdirSync(teamTasksDir).filter((f) => f.endsWith(".json"));
        for (const file of taskFiles) {
          const filePath = path.join(teamTasksDir, file);
          const stat = fs.statSync(filePath);
          try {
            const raw = fs.readFileSync(filePath, "utf-8");
            const task = JSON.parse(raw) as { id: string; subject: string; status: string };
            let eventType: ActivityEventType = "task_created";
            if (task.status === "completed") eventType = "task_completed";
            else if (task.status === "in_progress") eventType = "task_updated";

            events.push({
              timestamp: stat.mtime.toISOString(),
              type: eventType,
              team,
              description: `[${team}] Task #${task.id}: ${task.subject}`,
              metadata: { taskId: task.id, status: task.status },
            });
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable dirs */ }
    }
  }

  // Scan for recent team config changes
  const teamsDir = path.join(CLAUDE_DIR, "teams");
  if (fs.existsSync(teamsDir)) {
    const teamDirs = fs.readdirSync(teamsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    for (const dir of teamDirs) {
      const configPath = path.join(teamsDir, dir.name, "config.json");
      if (fs.existsSync(configPath)) {
        const stat = fs.statSync(configPath);
        events.push({
          timestamp: stat.mtime.toISOString(),
          type: "team_created",
          team: dir.name,
          description: `Team "${dir.name}" active`,
        });
      }
    }
  }

  // Sort by timestamp descending, limit to 100
  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 100);
}

// GET /api/activity?limit=50
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 100);
    const events = buildActivityEvents().slice(0, limit);
    return ok(events, { count: events.length });
  } catch (e) {
    return serverError(e);
  }
}
