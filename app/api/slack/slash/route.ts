/**
 * POST /api/slack/slash — Slack slash command handler.
 *
 * Handles /mc <subcommand> commands:
 *   /mc help           — show available commands
 *   /mc queue list     — list pending queue tasks
 *   /mc queue add <g>  — add a task to the queue
 *   /mc teams          — list active teams
 *   /mc status         — show system status
 *
 * Slack sends slash commands as URL-encoded form data.
 * See: https://api.slack.com/interactivity/slash-commands
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, getSlackConfigRaw, replyToSlashCommand } from "@/lib/slack";
import { db } from "@/lib/db";
import { listTeams, readTaskList } from "@/lib/claude-files";

// Slack slash command payload (URL-encoded form fields)
interface SlashCommandPayload {
  command: string;
  text: string;
  response_url: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  team_id: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Slack sends slash commands as application/x-www-form-urlencoded
  const rawBody = await req.text();

  // Verify signature
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  const config = await getSlackConfigRaw();
  if (!config) {
    return NextResponse.json(
      { response_type: "ephemeral", text: "Mission Control Slack integration is not configured." },
      { status: 200 }
    );
  }

  const isValid = await verifySlackSignature(
    rawBody,
    timestamp,
    signature,
    config.signingSecret
  );

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse URL-encoded form body
  const params = new URLSearchParams(rawBody);
  const payload: SlashCommandPayload = {
    command: params.get("command") ?? "/mc",
    text: params.get("text") ?? "",
    response_url: params.get("response_url") ?? "",
    user_id: params.get("user_id") ?? "",
    user_name: params.get("user_name") ?? "",
    channel_id: params.get("channel_id") ?? "",
    team_id: params.get("team_id") ?? "",
  };

  // Send immediate acknowledgement and process asynchronously
  void processSlashCommand(payload);

  // Immediate response to prevent Slack timeout (3 second limit)
  return NextResponse.json({
    response_type: "ephemeral",
    text: "Processing your request...",
  });
}

async function processSlashCommand(payload: SlashCommandPayload): Promise<void> {
  const text = payload.text.trim();
  const parts = text.split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase() ?? "help";

  try {
    switch (subcommand) {
      case "help":
      case "":
        await handleHelp(payload.response_url);
        break;

      case "queue":
        await handleQueue(parts.slice(1), payload);
        break;

      case "teams":
        await handleTeams(payload.response_url);
        break;

      case "status":
        await handleStatus(payload.response_url);
        break;

      default:
        await replyToSlashCommand(
          payload.response_url,
          `Unknown command: \`/mc ${subcommand}\`. Type \`/mc help\` to see available commands.`
        );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[slack/slash] Error processing command:", message);
    await replyToSlashCommand(
      payload.response_url,
      `Error processing command: ${message}`
    );
  }
}

// ── Command Handlers ──────────────────────────────────────────────────────────

async function handleHelp(responseUrl: string): Promise<void> {
  const text = [
    "*Mission Control Slash Commands*",
    "",
    "`/mc help` — Show this help message",
    "`/mc status` — Show system status (teams, queue, worker)",
    "`/mc teams` — List active agent teams",
    "`/mc queue list` — List pending queue tasks",
    "`/mc queue add <goal>` — Add a new task to the queue",
  ].join("\n");

  await replyToSlashCommand(responseUrl, text);
}

async function handleQueue(
  args: string[],
  payload: SlashCommandPayload
): Promise<void> {
  const action = args[0]?.toLowerCase() ?? "list";

  if (action === "list") {
    const tasks = await db.queuedTask.findMany({
      where: { status: { in: ["pending", "running"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 20,
    });

    if (tasks.length === 0) {
      await replyToSlashCommand(payload.response_url, "No pending or running tasks in queue.");
      return;
    }

    const lines = tasks.map((t) => {
      const statusEmoji = t.status === "running" ? "▶" : "⏳";
      return `${statusEmoji} *[${t.id}]* ${t.goal.slice(0, 80)} — \`${t.status}\``;
    });

    await replyToSlashCommand(
      payload.response_url,
      `*Queue Tasks (${tasks.length})*\n${lines.join("\n")}`
    );
    return;
  }

  if (action === "add") {
    const goal = args.slice(1).join(" ").trim();
    if (!goal) {
      await replyToSlashCommand(
        payload.response_url,
        "Usage: `/mc queue add <goal description>`"
      );
      return;
    }

    const task = await db.queuedTask.create({
      data: {
        goal,
        projectPath: process.cwd(),
        priority: 0,
      },
    });

    await replyToSlashCommand(
      payload.response_url,
      `Task #${task.id} added to queue: _${goal}_`
    );
    return;
  }

  await replyToSlashCommand(
    payload.response_url,
    `Unknown queue action: \`${action}\`. Use \`list\` or \`add <goal>\`.`
  );
}

async function handleTeams(responseUrl: string): Promise<void> {
  const teams = listTeams();

  if (teams.length === 0) {
    await replyToSlashCommand(responseUrl, "No active agent teams found.");
    return;
  }

  const lines = teams.map((t) => {
    const tasks = readTaskList(t.name);
    const completed = tasks.filter((tk) => tk.status === "completed").length;
    const inProgress = tasks.filter((tk) => tk.status === "in_progress").length;
    const pending = tasks.filter((tk) => tk.status === "pending").length;
    const members = (t.members ?? []).length;
    return `• *${t.name}* — ${members} members | tasks: ${inProgress} active, ${pending} pending, ${completed} done`;
  });

  await replyToSlashCommand(
    responseUrl,
    `*Agent Teams (${teams.length})*\n${lines.join("\n")}`
  );
}

async function handleStatus(responseUrl: string): Promise<void> {
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

  await replyToSlashCommand(responseUrl, lines.join("\n"));
}
