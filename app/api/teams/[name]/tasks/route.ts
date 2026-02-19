import { NextRequest } from "next/server";
import { readTaskList, writeTask, readTeamConfig, getTeamLastActivity } from "@/lib/claude-files";
import { ok, created, notFound, err, serverError, safeName } from "@/lib/api-helpers";
import type { TeamTask } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const STALENESS_MS = 5 * 60 * 1000;

// GET /api/teams/[name]/tasks — list tasks for a team
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const tasks = readTaskList(name);
    // Sort by explicit order if set, then by id as fallback
    const sorted = tasks.sort((a, b) => {
      const aOrder = a.order ?? Number(a.id);
      const bOrder = b.order ?? Number(b.id);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return Number(a.id) - Number(b.id);
    });
    return ok(sorted, { count: sorted.length });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/teams/[name]/tasks — create a new task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = await req.json() as Partial<TeamTask>;

    if (!body.subject || typeof body.subject !== "string") {
      return err("subject is required", "VALIDATION_ERROR");
    }

    // Generate a new ID by finding max existing + 1
    const existing = readTaskList(name);
    const maxId = existing.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);
    const newId = String(maxId + 1);

    const task: TeamTask = {
      id: newId,
      subject: body.subject,
      description: body.description,
      status: "pending",
      owner: body.owner,
      blockedBy: body.blockedBy ?? [],
      blocks: body.blocks ?? [],
      activeForm: body.activeForm,
      priority: body.priority,
      order: body.order,
      metadata: body.metadata,
    };

    writeTask(name, task);

    // Wake-on-task: if the team is asleep, send a wake message
    let woken = false;
    const lastActivity = getTeamLastActivity(name);
    const isAsleep = !lastActivity || (Date.now() - new Date(lastActivity).getTime()) > STALENESS_MS;

    if (isAsleep) {
      const inboxDir = path.join(CLAUDE_DIR, "teams", name, "inbox");
      fs.mkdirSync(inboxDir, { recursive: true });

      const wakeMessage = {
        type: "message",
        sender: "mission-control",
        recipient: "team-lead",
        content: `New task submitted: "${task.subject}". Please check your task list with TaskList.`,
        timestamp: new Date().toISOString(),
      };

      const filename = `wake-${Date.now()}.json`;
      fs.writeFileSync(
        path.join(inboxDir, filename),
        JSON.stringify(wakeMessage, null, 2),
        "utf-8"
      );
      woken = true;
    }

    return created({ ...task, woken });
  } catch (e) {
    return serverError(e);
  }
}
