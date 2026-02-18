import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { ok, err, serverError } from "@/lib/api-helpers";
import { launchTeamAsLeader, getLeaderSessionName, personaToLaunchable } from "@/lib/agent-launcher";
import type { TeamPlan, Teammate, TeamTask } from "@/types";

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { plan?: TeamPlan; projectPath?: string };
    const plan = body.plan;
    const projectPath = body.projectPath?.trim() || undefined;

    if (!plan || !plan.teamName || !plan.personas || !Array.isArray(plan.personas)) {
      return err("Invalid plan: teamName and personas are required", "VALIDATION_ERROR");
    }

    const teamName = safeName(plan.teamName);
    const teamDir = path.join(CLAUDE_DIR, "teams", teamName);
    const resolvedTeamDir = path.resolve(teamDir);
    assertSafePath(resolvedTeamDir);

    // Pre-populate ALL members in config so the UI shows them immediately.
    // Leader is active (has tmux session), personas start as pending (spawned as subagents).
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
    };

    // Write team config
    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, "config.json"),
      JSON.stringify(config, null, 2),
      "utf-8"
    );

    // Write initial tasks
    const taskDir = path.join(CLAUDE_DIR, "tasks", teamName);
    const resolvedTaskDir = path.resolve(taskDir);
    assertSafePath(resolvedTaskDir);
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

    // Launch a single leader session that will create and manage the team
    const launchable = plan.personas.map(personaToLaunchable);
    const result = await launchTeamAsLeader(
      teamName,
      plan.description ?? "",
      launchable,
      projectPath,
      tasks
    );

    return ok({
      teamName,
      membersCreated: members.length,
      tasksCreated: tasks.length,
      launched: result.launched ? ["leader"] : [],
      alreadyRunning: result.launched ? [] : ["leader"],
      sessions: [
        {
          name: "leader",
          tmuxSession: result.sessionName,
          attachCmd: `tmux attach -t ${result.sessionName}`,
        },
      ],
    });
  } catch (e) {
    return serverError(e);
  }
}
