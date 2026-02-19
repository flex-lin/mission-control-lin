import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { listTeams, readTeamConfig, readTaskList } from "@/lib/claude-files";
import { serverError } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Tool definitions exposed to the chatbot
const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_teams",
    description: "List all agent teams with their status and task statistics",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_team_detail",
    description: "Get detailed information about a specific team including members and tasks",
    input_schema: {
      type: "object" as const,
      properties: {
        teamName: {
          type: "string",
          description: "The name of the team",
        },
      },
      required: ["teamName"],
    },
  },
  {
    name: "create_team",
    description: "Create a new agent team with a name and description",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Team name (alphanumeric, dashes, underscores only)",
        },
        description: {
          type: "string",
          description: "Description of the team's purpose",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "send_message_to_team",
    description: "Send a message to a team member via their inbox",
    input_schema: {
      type: "object" as const,
      properties: {
        teamName: {
          type: "string",
          description: "The name of the team",
        },
        recipient: {
          type: "string",
          description: "The name of the team member to message",
        },
        content: {
          type: "string",
          description: "The message content to send",
        },
      },
      required: ["teamName", "recipient", "content"],
    },
  },
  {
    name: "submit_queue_task",
    description: "Submit a new task to the queue for automated execution by an agent team",
    input_schema: {
      type: "object" as const,
      properties: {
        goal: {
          type: "string",
          description: "Description of the task goal",
        },
        projectPath: {
          type: "string",
          description: "Absolute path to the project directory (optional, defaults to current project)",
        },
        priority: {
          type: "number",
          description: "Priority level: 0=none, 1=low, 2=medium, 3=high",
        },
      },
      required: ["goal"],
    },
  },
  {
    name: "list_queue_tasks",
    description: "List tasks in the queue with their status",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description: "Filter by status: pending, running, completed, failed, cancelled (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "cancel_queue_task",
    description: "Cancel a queued task by its ID",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: {
          type: "number",
          description: "The ID of the queue task to cancel",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "get_queue_worker_status",
    description: "Check the status of the queue worker (running/stopped, heartbeat, queue depth)",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_analytics_summary",
    description: "Get token usage and cost analytics summary",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          description: "Time period: 7d, 30d, or all (default: 7d)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_stuck_tasks",
    description: "Get a list of stuck or blocked tasks across all teams",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_team_health",
    description: "Get health status for a specific team including member statuses",
    input_schema: {
      type: "object" as const,
      properties: {
        teamName: {
          type: "string",
          description: "The name of the team",
        },
      },
      required: ["teamName"],
    },
  },
  {
    name: "wake_team",
    description: "Wake a sleeping or stopped team by restarting its session",
    input_schema: {
      type: "object" as const,
      properties: {
        teamName: {
          type: "string",
          description: "The name of the team to wake",
        },
        message: {
          type: "string",
          description: "Optional message to send when waking the team",
        },
      },
      required: ["teamName"],
    },
  },
  {
    name: "get_proxy_logs",
    description: "Get recent proxy logs showing API request details for debugging",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of recent log entries to fetch (default: 20)",
        },
        teamName: {
          type: "string",
          description: "Filter logs by team name (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_dashboard_stats",
    description: "Get overview dashboard statistics: team counts, task counts, recent activity",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "update_team_task",
    description: "Update a task within a team (status, owner, priority, description)",
    input_schema: {
      type: "object" as const,
      properties: {
        teamName: {
          type: "string",
          description: "The name of the team",
        },
        taskId: {
          type: "string",
          description: "The ID of the task to update",
        },
        status: {
          type: "string",
          description: "New status: pending, in_progress, completed, or deleted",
        },
        owner: {
          type: "string",
          description: "Assign to a team member",
        },
        priority: {
          type: "string",
          description: "Priority: low, medium, high, or urgent",
        },
      },
      required: ["teamName", "taskId"],
    },
  },
];

// Execute a tool call and return the result as a string
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case "list_teams": {
        const teams = listTeams();
        const result = teams.map((t) => {
          const tasks = readTaskList(t.name);
          const total = tasks.length;
          const completed = tasks.filter((task) => task.status === "completed").length;
          const inProgress = tasks.filter((task) => task.status === "in_progress").length;
          const pending = tasks.filter((task) => task.status === "pending").length;
          return {
            name: t.name,
            description: t.description ?? "",
            memberCount: (t.members ?? []).length,
            tasks: { total, completed, inProgress, pending },
          };
        });
        return JSON.stringify({ teams: result, count: result.length });
      }

      case "get_team_detail": {
        const { teamName } = toolInput as { teamName: string };
        const team = readTeamConfig(teamName);
        if (!team) return JSON.stringify({ error: `Team "${teamName}" not found` });
        const tasks = readTaskList(teamName);
        return JSON.stringify({ team, tasks });
      }

      case "create_team": {
        const { name, description } = toolInput as { name: string; description?: string };
        const res = await fetch(
          new URL("/api/teams", process.env.NEXTAUTH_URL ?? "http://localhost:3777"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description }),
          }
        );
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return JSON.stringify({ error: data.error ?? `HTTP ${res.status}` });
        return JSON.stringify({ success: true, team: data.data });
      }

      case "send_message_to_team": {
        const { teamName, recipient, content } = toolInput as {
          teamName: string;
          recipient: string;
          content: string;
        };
        const team = readTeamConfig(teamName);
        if (!team) return JSON.stringify({ error: `Team "${teamName}" not found` });

        const member = team.members.find((m) => m.name === recipient);
        if (!member) {
          return JSON.stringify({ error: `Teammate "${recipient}" not found in team "${teamName}"` });
        }

        const message = {
          id: `msg-${Date.now()}`,
          from: "chatbot",
          to: recipient,
          content,
          timestamp: new Date().toISOString(),
        };

        // Validate recipient name to prevent path traversal (safeName: alphanumeric, dash, underscore only)
        if (!/^[\w-]+$/.test(recipient)) {
          return JSON.stringify({ error: `Invalid recipient name: "${recipient}"` });
        }
        const inboxDir = path.join(CLAUDE_DIR, "teams", teamName, "inboxes");
        const inboxFile = path.join(inboxDir, `${recipient}.json`);
        // Double-check resolved path stays within CLAUDE_DIR
        const resolvedInbox = path.resolve(inboxFile);
        if (!resolvedInbox.startsWith(path.resolve(CLAUDE_DIR) + path.sep)) {
          return JSON.stringify({ error: "Path traversal blocked" });
        }
        fs.mkdirSync(inboxDir, { recursive: true });

        let messages: typeof message[] = [];
        if (fs.existsSync(inboxFile)) {
          try {
            messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8")) as typeof message[];
          } catch { /* start fresh */ }
        }
        messages.push(message);
        fs.writeFileSync(inboxFile, JSON.stringify(messages, null, 2), "utf-8");
        return JSON.stringify({ success: true, message });
      }

      case "submit_queue_task": {
        const { goal, projectPath, priority } = toolInput as {
          goal: string;
          projectPath?: string;
          priority?: number;
        };
        const task = await db.queuedTask.create({
          data: {
            goal: goal.trim(),
            projectPath: projectPath?.trim() || process.cwd(),
            priority: priority ?? 0,
          },
        });
        return JSON.stringify({ success: true, task });
      }

      case "list_queue_tasks": {
        const { status: statusFilter } = toolInput as { status?: string };
        const where = statusFilter ? { status: statusFilter } : {};
        const tasks = await db.queuedTask.findMany({
          where,
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
          take: 50,
        });
        return JSON.stringify({ tasks, count: tasks.length });
      }

      case "cancel_queue_task": {
        const { taskId } = toolInput as { taskId: number };
        const task = await db.queuedTask.findUnique({ where: { id: taskId } });
        if (!task) return JSON.stringify({ error: `Task ${taskId} not found` });
        if (task.status === "completed" || task.status === "cancelled") {
          return JSON.stringify({ error: `Task ${taskId} is already ${task.status}` });
        }
        await db.queuedTask.update({
          where: { id: taskId },
          data: { status: "cancelled" },
        });
        return JSON.stringify({ success: true, taskId, status: "cancelled" });
      }

      case "get_queue_worker_status": {
        const heartbeatFile = path.join(
          process.env.HOME ?? "/root",
          ".claude",
          "queue-worker.heartbeat"
        );
        let lastHeartbeat: string | null = null;
        let heartbeatFresh = false;
        try {
          const raw = fs.readFileSync(heartbeatFile, "utf-8");
          const hb = JSON.parse(raw) as { timestamp?: string };
          lastHeartbeat = hb.timestamp ?? null;
          if (lastHeartbeat) {
            const age = Date.now() - new Date(lastHeartbeat).getTime();
            heartbeatFresh = age < 60_000; // fresh if <60s old
          }
        } catch { /* no heartbeat file */ }

        const counts = await db.queuedTask.groupBy({
          by: ["status"],
          _count: { status: true },
        });
        const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));
        const queueDepth = (countMap["pending"] ?? 0) + (countMap["running"] ?? 0);

        return JSON.stringify({
          workerRunning: heartbeatFresh,
          lastHeartbeat,
          queueDepth,
          counts: {
            pending: countMap["pending"] ?? 0,
            running: countMap["running"] ?? 0,
            completed: countMap["completed"] ?? 0,
            failed: countMap["failed"] ?? 0,
          },
        });
      }

      case "get_analytics_summary": {
        const { period = "7d" } = toolInput as { period?: string };
        const cutoff = period === "all"
          ? new Date(0)
          : period === "30d"
            ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const logs = await db.proxyLog.aggregate({
          where: { timestamp: { gte: cutoff } },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
          },
          _count: { id: true },
        });

        return JSON.stringify({
          period,
          totalRequests: logs._count.id,
          tokens: {
            input: logs._sum.inputTokens ?? 0,
            output: logs._sum.outputTokens ?? 0,
            cacheRead: logs._sum.cacheReadTokens ?? 0,
            cacheCreation: logs._sum.cacheCreationTokens ?? 0,
          },
        });
      }

      case "get_stuck_tasks": {
        const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
        const teams = listTeams();
        const stuck: Array<{
          teamName: string;
          taskId: string;
          subject: string;
          status: string;
          owner?: string;
          blockerType?: string;
          blockerSummary?: string;
        }> = [];

        for (const team of teams) {
          const tasks = readTaskList(team.name);
          const tasksDir = path.join(CLAUDE_DIR, "tasks", team.name);
          for (const task of tasks) {
            if (task.status !== "in_progress") continue;
            try {
              const taskFile = path.join(tasksDir, `${task.id}.json`);
              const stat = fs.statSync(taskFile);
              if (Date.now() - stat.mtimeMs > STUCK_THRESHOLD_MS) {
                const meta = task.metadata as Record<string, unknown> | undefined;
                stuck.push({
                  teamName: team.name,
                  taskId: task.id,
                  subject: task.subject,
                  status: task.status,
                  owner: task.owner,
                  blockerType: meta?.blockerType as string | undefined,
                  blockerSummary: meta?.blockerSummary as string | undefined,
                });
              }
            } catch { /* skip */ }
          }
        }
        return JSON.stringify({ stuckTasks: stuck, count: stuck.length });
      }

      case "get_team_health": {
        const { teamName } = toolInput as { teamName: string };
        const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3777";
        const res = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamName)}/health`);
        if (!res.ok) return JSON.stringify({ error: `Failed to get health for "${teamName}"` });
        const data = await res.json() as Record<string, unknown>;
        return JSON.stringify(data.data ?? data);
      }

      case "wake_team": {
        const { teamName, message } = toolInput as { teamName: string; message?: string };
        const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3777";
        const res = await fetch(
          `${baseUrl}/api/teams/${encodeURIComponent(teamName)}/wake`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          }
        );
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return JSON.stringify({ error: data.error ?? `HTTP ${res.status}` });
        return JSON.stringify(data.data ?? data);
      }

      case "get_proxy_logs": {
        const { limit = 20, teamName } = toolInput as { limit?: number; teamName?: string };
        const where = teamName ? { teamName } : {};
        const logs = await db.proxyLog.findMany({
          where,
          orderBy: { timestamp: "desc" },
          take: Math.min(limit, 100),
          select: {
            id: true,
            timestamp: true,
            model: true,
            inputTokens: true,
            outputTokens: true,
            teamName: true,
            memberName: true,
            statusCode: true,
            latencyMs: true,
          },
        });
        return JSON.stringify({ logs, count: logs.length });
      }

      case "get_dashboard_stats": {
        const teams = listTeams();
        let totalTasks = 0;
        let completedTasks = 0;
        let activeTasks = 0;

        for (const team of teams) {
          const tasks = readTaskList(team.name);
          totalTasks += tasks.length;
          completedTasks += tasks.filter((t) => t.status === "completed").length;
          activeTasks += tasks.filter((t) => t.status === "in_progress").length;
        }

        const queueCounts = await db.queuedTask.groupBy({
          by: ["status"],
          _count: { status: true },
        });
        const queueMap = Object.fromEntries(queueCounts.map((c) => [c.status, c._count.status]));

        return JSON.stringify({
          teams: {
            total: teams.length,
          },
          tasks: {
            total: totalTasks,
            completed: completedTasks,
            active: activeTasks,
          },
          queue: {
            pending: queueMap["pending"] ?? 0,
            running: queueMap["running"] ?? 0,
            completed: queueMap["completed"] ?? 0,
            failed: queueMap["failed"] ?? 0,
          },
        });
      }

      case "update_team_task": {
        const { teamName, taskId, status, owner, priority } = toolInput as {
          teamName: string;
          taskId: string;
          status?: string;
          owner?: string;
          priority?: string;
        };
        const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3777";
        const body: Record<string, unknown> = {};
        if (status) body.status = status;
        if (owner) body.owner = owner;
        if (priority) body.priority = priority;

        const res = await fetch(
          `${baseUrl}/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return JSON.stringify({ error: data.error ?? `HTTP ${res.status}` });
        return JSON.stringify({ success: true, task: data.data ?? data });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error("[chatbot] tool execution error:", e instanceof Error ? e.message : e);
    return JSON.stringify({ error: "Tool execution failed" });
  }
}

// POST /api/chatbot — streaming chat with tool use
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    const systemPrompt = `You are a Mission Control assistant — a helpful AI interface for managing Claude Code agent teams and monitoring their work. You have access to tools that let you interact with all aspects of Mission Control.

Mission Control is a local dashboard that manages:
- Agent teams: groups of Claude Code agents working on tasks in tmux sessions
- Task queue: tasks submitted for automated execution by agent teams
- Analytics: token usage and cost tracking via proxy
- Stuck tasks: blocked or stalled tasks that need attention

Your capabilities:
- List, inspect, and manage agent teams
- Submit new tasks to the queue for execution
- Monitor queue worker status and task progress
- Check analytics and usage data
- Identify and surface stuck/blocked tasks
- Send messages to specific team members
- Wake sleeping teams
- Update task statuses and assignments

Be concise and helpful. When performing actions, confirm what you did. When data is returned, summarize the key information clearly. Use markdown formatting for lists and tables when it improves readability.`;

    // Convert messages to Anthropic format
    // Use a flexible array type to accommodate both string content and block arrays
    type FlexMessage = { role: "user" | "assistant"; content: string | Anthropic.ContentBlock[] | Anthropic.ToolResultBlockParam[] };
    const messages: FlexMessage[] = body.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Agentic loop: keep calling the model until it returns end_turn
    const MAX_ITERATIONS = 10;
    let iteration = 0;
    let finalText = "";

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages: messages as Anthropic.MessageParam[],
      });

      // Add assistant response to messages (with block array content)
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        // Extract text from final response
        for (const block of response.content) {
          if (block.type === "text") {
            finalText += block.text;
          }
        }
        break;
      }

      if (response.stop_reason === "tool_use") {
        // Execute all tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            const result = await executeTool(
              block.name,
              block.input as Record<string, unknown>
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }
        }

        // Add tool results to messages and continue loop
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Unexpected stop reason
      break;
    }

    return NextResponse.json({ reply: finalText });
  } catch (e) {
    return serverError(e);
  }
}
