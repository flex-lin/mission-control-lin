import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { ok, err, serverError } from "@/lib/api-helpers";
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
    const body = (await req.json()) as { plan?: TeamPlan };
    const plan = body.plan;

    if (!plan || !plan.teamName || !plan.personas || !Array.isArray(plan.personas)) {
      return err("Invalid plan: teamName and personas are required", "VALIDATION_ERROR");
    }

    const teamName = safeName(plan.teamName);
    const teamDir = path.join(CLAUDE_DIR, "teams", teamName);
    const resolvedTeamDir = path.resolve(teamDir);
    assertSafePath(resolvedTeamDir);

    // Map personas to Teammate format
    const members: Teammate[] = plan.personas.map((p, i) => ({
      name: safeName(p.name),
      agentId: `${teamName}-${p.name}-${i}`,
      agentType: p.agentType || "general-purpose",
      status: "idle" as const,
    }));

    const config = {
      name: teamName,
      description: plan.description ?? "",
      members,
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

    let tasksCreated = 0;
    const tasks = plan.initialTasks ?? [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
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
      tasksCreated++;
    }

    return ok({
      teamName,
      membersCreated: members.length,
      tasksCreated,
    });
  } catch (e) {
    return serverError(e);
  }
}
