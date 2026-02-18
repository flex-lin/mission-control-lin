import { NextRequest, NextResponse } from "next/server";
import { listTeams, readTaskList } from "@/lib/claude-files";
import { ok, serverError } from "@/lib/api-helpers";
import type { StuckTask } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const STALENESS_MS = 5 * 60 * 1000;

// GET /api/teams/stuck — aggregated stuck tasks across all teams
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const teamFilter = req.nextUrl.searchParams.get("team");
    const teams = listTeams();
    const now = Date.now();
    const stuckTasks: StuckTask[] = [];
    const stuckTeamNames = new Set<string>();

    const targetTeams = teamFilter
      ? teams.filter((t) => t.name === teamFilter)
      : teams;

    for (const team of targetTeams) {
      const tasks = readTaskList(team.name);
      const tasksBasePath = path.join(CLAUDE_DIR, "tasks", team.name);

      for (const task of tasks) {
        if (task.status !== "in_progress") continue;

        const hasBlockerMeta = task.metadata?.blockerSummary;
        let isStale = false;

        try {
          const taskFile = path.join(tasksBasePath, `${task.id}.json`);
          const stat = fs.statSync(taskFile);
          if (now - stat.mtimeMs > STALENESS_MS) {
            isStale = true;
          }
        } catch {
          // skip inaccessible
        }

        if (!hasBlockerMeta && !isStale) continue;

        stuckTeamNames.add(team.name);
        stuckTasks.push({
          ...task,
          teamName: team.name,
          blockerType: task.metadata?.blockerType as StuckTask["blockerType"],
          blockerSummary: (task.metadata?.blockerSummary as string) ??
            (isStale ? "Task appears stale (no activity)" : undefined),
          blockerDetails: task.metadata?.blockerDetails as string | undefined,
          blockerSince: (task.metadata?.blockerSince as string) ??
            (isStale ? new Date(now - STALENESS_MS).toISOString() : undefined),
          blockerFrom: task.metadata?.blockerFrom as string | undefined,
        });
      }
    }

    // Sort by blockerSince descending (most recent first)
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
