/**
 * Team spawning logic — extracted from app/api/teams/spawn/route.ts
 * so it can be called from both the API route and the queue worker.
 */
import fs from "fs";
import path from "path";
import { launchTeamAsLeader, getLeaderSessionName, personaToLaunchable } from "@/lib/agent-launcher";
import { writeBackgroundConfig, DEFAULT_BACKGROUND_CONFIG } from "@/lib/sleep-detector";
import type { TeamPlan, Teammate, TeamTask } from "@/types";

export class DuplicateTeamError extends Error {
  constructor(teamName: string) {
    super(`Team "${teamName}" already exists — cannot spawn duplicate`);
    this.name = "DuplicateTeamError";
  }
}

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function assertSafePath(resolvedPath: string): void {
  const resolved = path.resolve(resolvedPath);
  if (!resolved.startsWith(path.resolve(CLAUDE_DIR) + path.sep) && resolved !== path.resolve(CLAUDE_DIR)) {
    throw new Error(`Path traversal attempt blocked: ${resolvedPath}`);
  }
}

function safeName(name: string): string {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

export interface SpawnResult {
  teamName: string;
  membersCreated: number;
  tasksCreated: number;
  launched: string[];
  sessions: { name: string; tmuxSession: string; attachCmd: string }[];
}

export async function spawnTeam(
  plan: TeamPlan,
  projectPath?: string,
  options?: { persistent?: boolean }
): Promise<SpawnResult> {
  const teamName = safeName(plan.teamName);
  const teamDir = path.join(CLAUDE_DIR, "teams", teamName);
  assertSafePath(path.resolve(teamDir));

  // One-team-per-task guard: reject if team directory already exists (prevents duplicates)
  if (fs.existsSync(path.join(teamDir, "config.json"))) {
    throw new DuplicateTeamError(teamName);
  }

  // Pre-populate ALL members in config
  const leaderSessionName = getLeaderSessionName(teamName);
  const members: Teammate[] = [
    {
      name: "leader",
      agentId: `${teamName}-leader-0`,
      agentType: "general-purpose",
      status: "active" as const,
      tmuxSession: leaderSessionName,
    },
    ...plan.personas.map((p, i) => ({
      name: p.name,
      agentId: `${teamName}-${p.name}-${i}`,
      agentType: p.agentType ?? "general-purpose",
      status: "idle" as const,
    })),
  ];

  const config = {
    name: teamName,
    description: plan.description ?? "",
    members,
    projectPath,
    createdAt: new Date().toISOString(),
    ...(plan.sourceTaskId != null ? { sourceTaskId: plan.sourceTaskId } : {}),
  };

  // Write team config
  fs.mkdirSync(teamDir, { recursive: true });
  fs.writeFileSync(
    path.join(teamDir, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  // Write plan.json alongside config for dashboard viewing
  fs.writeFileSync(
    path.join(teamDir, "plan.json"),
    JSON.stringify(plan, null, 2),
    "utf-8"
  );

  // Write background execution config if persistent flag is set
  if (options?.persistent) {
    writeBackgroundConfig(teamName, {
      ...DEFAULT_BACKGROUND_CONFIG,
      persistent: true,
    });
  }

  // Write initial tasks
  const taskDir = path.join(CLAUDE_DIR, "tasks", teamName);
  assertSafePath(path.resolve(taskDir));
  fs.mkdirSync(taskDir, { recursive: true });

  const tasks: TeamTask[] = [];
  const initialTasks = plan.initialTasks ?? [];
  for (let i = 0; i < initialTasks.length; i++) {
    const t = initialTasks[i];
    const taskId = String(i + 1);
    const task: TeamTask = {
      id: taskId,
      subject: t.subject,
      description: t.description,
      status: "pending",
      owner: t.assignTo,
    };
    fs.writeFileSync(
      path.join(taskDir, `${taskId}.json`),
      JSON.stringify(task, null, 2),
      "utf-8"
    );
    tasks.push(task);
  }

  // Launch leader
  const launchable = plan.personas.map(personaToLaunchable);
  const result = await launchTeamAsLeader(
    teamName,
    plan.description ?? "",
    launchable,
    projectPath,
    tasks
  );

  return {
    teamName,
    membersCreated: members.length,
    tasksCreated: tasks.length,
    launched: result.launched ? ["leader"] : [],
    sessions: [
      {
        name: "leader",
        tmuxSession: result.sessionName,
        attachCmd: `tmux attach -t ${result.sessionName}`,
      },
    ],
  };
}
