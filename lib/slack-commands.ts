/**
 * Shared slash command handlers for Slack.
 * Used by both HTTP slash route and Socket Mode handler.
 */
import { db } from "@/lib/db";
import { listTeams, readTaskList } from "@/lib/claude-files";

export interface SlashCommandContext {
  command: string;
  text: string;
  userId: string;
  userName: string;
  channelId: string;
  teamId: string;
}

export interface CommandResponse {
  text: string;
  blocks?: unknown[];
  response_type?: "ephemeral" | "in_channel";
}

/**
 * Process a slash command and return the response.
 * This is a pure handler — the caller is responsible for delivering the response.
 */
export async function handleSlashCommand(
  ctx: SlashCommandContext
): Promise<CommandResponse> {
  const text = ctx.text.trim();
  const parts = text.split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase() ?? "help";

  switch (subcommand) {
    case "help":
    case "":
      return buildHelp();

    case "queue":
      return buildQueue(parts.slice(1));

    case "teams":
      return buildTeams();

    case "status":
      return buildStatus();

    default:
      return {
        text: `Unknown command: \`/mc ${subcommand}\`. Type \`/mc help\` to see available commands.`,
        response_type: "ephemeral",
      };
  }
}

function buildHelp(): CommandResponse {
  const text = [
    "*Mission Control Slash Commands*",
    "",
    "`/mc help` — Show this help message",
    "`/mc status` — Show system status (teams, queue, worker)",
    "`/mc teams` — List active agent teams",
    "`/mc queue list` — List pending queue tasks",
    "`/mc queue add <goal>` — Add a new task to the queue",
  ].join("\n");

  return { text, response_type: "ephemeral" };
}

async function buildQueue(args: string[]): Promise<CommandResponse> {
  const action = args[0]?.toLowerCase() ?? "list";

  if (action === "list") {
    const tasks = await db.queuedTask.findMany({
      where: { status: { in: ["pending", "running"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 20,
    });

    if (tasks.length === 0) {
      return { text: "No pending or running tasks in queue.", response_type: "ephemeral" };
    }

    const lines = tasks.map((t) => {
      const statusEmoji = t.status === "running" ? "▶" : "⏳";
      return `${statusEmoji} *[${t.id}]* ${t.goal.slice(0, 80)} — \`${t.status}\``;
    });

    return {
      text: `*Queue Tasks (${tasks.length})*\n${lines.join("\n")}`,
      response_type: "ephemeral",
    };
  }

  if (action === "add") {
    const goal = args.slice(1).join(" ").trim();
    if (!goal) {
      return {
        text: "Usage: `/mc queue add <goal description>`",
        response_type: "ephemeral",
      };
    }

    const task = await db.queuedTask.create({
      data: {
        goal,
        projectPath: process.cwd(),
        priority: 0,
      },
    });

    return {
      text: `Task #${task.id} added to queue: _${goal}_`,
      response_type: "ephemeral",
    };
  }

  return {
    text: `Unknown queue action: \`${action}\`. Use \`list\` or \`add <goal>\`.`,
    response_type: "ephemeral",
  };
}

function buildTeams(): CommandResponse {
  const teams = listTeams();

  if (teams.length === 0) {
    return { text: "No active agent teams found.", response_type: "ephemeral" };
  }

  const lines = teams.map((t) => {
    const tasks = readTaskList(t.name);
    const completed = tasks.filter((tk) => tk.status === "completed").length;
    const inProgress = tasks.filter((tk) => tk.status === "in_progress").length;
    const pending = tasks.filter((tk) => tk.status === "pending").length;
    const members = (t.members ?? []).length;
    return `• *${t.name}* — ${members} members | tasks: ${inProgress} active, ${pending} pending, ${completed} done`;
  });

  return {
    text: `*Agent Teams (${teams.length})*\n${lines.join("\n")}`,
    response_type: "ephemeral",
  };
}

async function buildStatus(): Promise<CommandResponse> {
  const teams = listTeams();
  const queueCounts = await db.queuedTask.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const countMap = Object.fromEntries(
    queueCounts.map((c) => [c.status, c._count.status])
  );

  const lines = [
    `*Mission Control Status*`,
    "",
    `*Teams:* ${teams.length} active`,
    `*Queue:* ${countMap["pending"] ?? 0} pending | ${countMap["running"] ?? 0} running | ${countMap["completed"] ?? 0} completed | ${countMap["failed"] ?? 0} failed`,
  ];

  return { text: lines.join("\n"), response_type: "ephemeral" };
}
