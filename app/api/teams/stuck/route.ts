import { NextRequest, NextResponse } from "next/server";
import { listTeams, readTaskList } from "@/lib/claude-files";
import { ok, serverError } from "@/lib/api-helpers";
import type { StuckTask } from "@/types";
import path from "path";
import fs from "fs";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// Tasks in_progress without modification for more than this threshold are considered stale/stuck
const STALENESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// GET /api/teams/stuck — aggregated stuck tasks across all teams
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const teamFilter = req.nextUrl.searchParams.get("team");
    const teams = listTeams();
    const stuckTasks: StuckTask[] = [];
    const stuckTeamNames = new Set<string>();

    const targetTeams = teamFilter
      ? teams.filter((t) => t.name === teamFilter)
      : teams;

    const now = Date.now();

    for (const team of targetTeams) {
      const tasks = readTaskList(team.name);
      const tasksBasePath = path.join(CLAUDE_DIR, "tasks", team.name);

      for (const task of tasks) {
        if (task.status !== "in_progress") continue;

        // Case 1: task has explicit blocker metadata (original behavior)
        if (task.metadata?.blockerSummary) {
          stuckTeamNames.add(team.name);
          stuckTasks.push({
            ...task,
            teamName: team.name,
            blockerType: task.metadata.blockerType as StuckTask["blockerType"],
            blockerSummary: task.metadata.blockerSummary as string,
            blockerDetails: task.metadata.blockerDetails as string | undefined,
            blockerSince: task.metadata.blockerSince as string | undefined,
            blockerFrom: task.metadata.blockerFrom as string | undefined,
          });
          continue;
        }

        // Case 2: task file has not been modified for more than the staleness threshold
        try {
          // Validate task.id to prevent path traversal from crafted task files
          if (!/^[\w-]+$/.test(String(task.id))) continue;
          const taskFile = path.join(tasksBasePath, `${task.id}.json`);
          const stat = fs.statSync(taskFile);
          const ageMs = now - stat.mtimeMs;

          if (ageMs > STALENESS_THRESHOLD_MS) {
            stuckTeamNames.add(team.name);
            stuckTasks.push({
              ...task,
              teamName: team.name,
              blockerType: "error",
              blockerSummary: `Task has been in_progress for ${Math.round(ageMs / 60_000)} minutes without progress`,
              blockerSince: new Date(stat.mtimeMs).toISOString(),
            });
          }
        } catch {
          // Cannot stat the task file — skip staleness check
        }
      }
    }

    // Sort: explicit blockers first (they have recent blockerSince), then stale tasks
    stuckTasks.sort((a, b) => {
      const aTime = a.blockerSince ? new Date(a.blockerSince).getTime() : 0;
      const bTime = b.blockerSince ? new Date(b.blockerSince).getTime() : 0;
      return bTime - aTime;
    });

    return ok(stuckTasks, {
      totalTeams: targetTeams.length,
      stuckTeams: stuckTeamNames.size,
      totalBlockers: stuckTasks.length,
    });
  } catch (e) {
    return serverError(e);
  }
}
