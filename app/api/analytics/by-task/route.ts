import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate } from "@/lib/analytics-helpers";
import { listTeams, readTaskList } from "@/lib/claude-files";
import type { TeamTask } from "@/types";

export interface TaskTokenEntry {
  taskId: string;
  subject: string;
  status: string;
  owner: string | null;
  teamName: string;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  estimatedCost: number;
  requests: number;
  attribution: "exact" | "team-level";
}

type TokenStats = {
  totalInput: number;
  totalOutput: number;
  estimatedCost: number;
  requests: number;
};

const TASKS_ARCHIVE_DIR = path.join(
  process.env.HOME ?? "/root",
  ".claude",
  "tasks-archive"
);

/**
 * Read tasks from archived teams on disk.
 */
function readArchivedTasks(): Map<string, TeamTask[]> {
  const result = new Map<string, TeamTask[]>();
  if (!fs.existsSync(TASKS_ARCHIVE_DIR)) return result;

  const entries = fs.readdirSync(TASKS_ARCHIVE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const teamDir = path.join(TASKS_ARCHIVE_DIR, entry.name);
    const files = fs.readdirSync(teamDir);
    const tasks: TeamTask[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(teamDir, file), "utf-8");
        tasks.push(JSON.parse(raw) as TeamTask);
      } catch {
        // skip malformed task files
      }
    }
    if (tasks.length > 0) result.set(entry.name, tasks);
  }
  return result;
}

/**
 * Build by-task token attribution by correlating file-based task data
 * (active + archived teams) with proxy log records.
 *
 * Strategy: task-centric — collect all tasks from active and archived teams,
 * then match proxy logs to task owners via (teamName, memberName === owner).
 */
export async function buildByTaskData(cutoff: Date): Promise<TaskTokenEntry[]> {
  // 1. Collect all tasks from active teams
  const allTasks = new Map<string, TeamTask[]>();
  const activeTeams = listTeams();
  for (const team of activeTeams) {
    const tasks = readTaskList(team.name);
    if (tasks.length > 0) allTasks.set(team.name, tasks);
  }

  // 2. Collect tasks from archived teams
  const archivedTasks = readArchivedTasks();
  for (const [teamName, tasks] of archivedTasks) {
    if (!allTasks.has(teamName)) {
      allTasks.set(teamName, tasks);
    }
  }

  // 3. Query proxy logs grouped by (teamName, memberName, model)
  const rows = await db.proxyLog.groupBy({
    by: ["teamName", "memberName", "model"],
    where: { timestamp: { gte: cutoff } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
    _count: { id: true },
  });

  // 4. Build member-level token stats: "team:member" → stats
  const memberMap = new Map<string, TokenStats>();
  for (const r of rows) {
    const team = r.teamName;
    const member = r.memberName;
    if (!team || !member) continue;

    const baseInput = r._sum.inputTokens ?? 0;
    const output = r._sum.outputTokens ?? 0;
    const cacheRead = r._sum.cacheReadTokens ?? 0;
    const cacheCreate = r._sum.cacheCreationTokens ?? 0;
    const input = baseInput + cacheRead + cacheCreate;
    const cost = computeCost(r.model, baseInput, output, cacheRead, cacheCreate);

    const key = `${team}:${member}`;
    const existing = memberMap.get(key) ?? { totalInput: 0, totalOutput: 0, estimatedCost: 0, requests: 0 };
    existing.totalInput += input;
    existing.totalOutput += output;
    existing.estimatedCost += cost;
    existing.requests += r._count.id;
    memberMap.set(key, existing);
  }

  // 5. Build task entries by correlating tasks with proxy log stats
  const data: TaskTokenEntry[] = [];

  for (const [teamName, tasks] of allTasks) {
    for (const task of tasks) {
      const owner = task.owner ?? null;
      let stats: TokenStats = { totalInput: 0, totalOutput: 0, estimatedCost: 0, requests: 0 };

      if (owner) {
        const key = `${teamName}:${owner}`;
        const memberStats = memberMap.get(key);
        if (memberStats) {
          stats = memberStats;
        }
      }

      data.push({
        taskId: task.id,
        subject: task.subject,
        status: task.status,
        owner,
        teamName,
        totalInput: stats.totalInput,
        totalOutput: stats.totalOutput,
        totalTokens: stats.totalInput + stats.totalOutput,
        estimatedCost: stats.estimatedCost,
        requests: stats.requests,
        attribution: owner ? "exact" : "team-level",
      });
    }
  }

  return data;
}

// GET /api/analytics/by-task?period=7d
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);
    const data = await buildByTaskData(cutoff);
    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
