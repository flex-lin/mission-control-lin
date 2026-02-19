import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { listTeams, readTeamConfig, readTaskList } from "@/lib/claude-files";
import { db } from "@/lib/db";
import type { KnowledgeBaseEntry } from "@/types";

// ── Tool definitions for Claude ──────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: "list_teams",
    description:
      "List all active agent teams with their health status and task statistics.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_team_health",
    description:
      "Get detailed health and status for a specific agent team, including members and task stats.",
    input_schema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "The name of the team to check",
        },
      },
      required: ["team_name"],
    },
  },
  {
    name: "get_team_tasks",
    description: "List all tasks for a specific agent team with their statuses.",
    input_schema: {
      type: "object" as const,
      properties: {
        team_name: {
          type: "string",
          description: "The name of the team",
        },
      },
      required: ["team_name"],
    },
  },
  {
    name: "submit_queue_task",
    description:
      "Submit a new task to the queue for automated agent execution. The queue worker will pick it up and spawn a team.",
    input_schema: {
      type: "object" as const,
      properties: {
        goal: {
          type: "string",
          description: "The goal/description of the task to accomplish",
        },
        project_path: {
          type: "string",
          description:
            "Absolute path to the project directory. Defaults to the current working directory if not provided.",
        },
        priority: {
          type: "number",
          description:
            "Priority level (higher number = higher priority). Defaults to 0.",
        },
      },
      required: ["goal"],
    },
  },
  {
    name: "list_queue_tasks",
    description:
      "List tasks in the queue with their statuses (pending, running, completed, failed, cancelled).",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description:
            'Filter by status: "pending", "running", "completed", "failed", "cancelled", or "all". Defaults to "all".',
        },
      },
      required: [],
    },
  },
  {
    name: "search_knowledge_base",
    description:
      "Search registered project entries in the knowledge base by name, path, or tags.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to match against project names, paths, or tags",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_knowledge_base_entry",
    description:
      "Get detailed information about a specific project in the knowledge base by its ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "number",
          description: "The ID of the knowledge base entry",
        },
      },
      required: ["id"],
    },
  },
];

// ── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "list_teams": {
      const teams = listTeams();
      const result = teams.map((t) => {
        const tasks = readTaskList(t.name);
        const taskStats = {
          total: tasks.length,
          completed: tasks.filter((tk) => tk.status === "completed").length,
          pending: tasks.filter((tk) => tk.status === "pending").length,
          inProgress: tasks.filter((tk) => tk.status === "in_progress").length,
        };
        return {
          name: t.name,
          description: t.description,
          members: (t.members ?? []).map((m) => ({
            name: m.name,
            role: m.agentType,
            status: m.status,
          })),
          taskStats,
        };
      });
      return JSON.stringify(result, null, 2);
    }

    case "get_team_health": {
      const teamName = input.team_name as string;
      const team = readTeamConfig(teamName);
      if (!team) return JSON.stringify({ error: `Team "${teamName}" not found` });

      const tasks = readTaskList(teamName);
      const taskStats = {
        total: tasks.length,
        completed: tasks.filter((tk) => tk.status === "completed").length,
        pending: tasks.filter((tk) => tk.status === "pending").length,
        inProgress: tasks.filter((tk) => tk.status === "in_progress").length,
      };
      return JSON.stringify(
        {
          name: team.name,
          description: team.description,
          members: (team.members ?? []).map((m) => ({
            name: m.name,
            agentType: m.agentType,
            status: m.status,
          })),
          taskStats,
          createdAt: team.createdAt,
        },
        null,
        2
      );
    }

    case "get_team_tasks": {
      const teamName = input.team_name as string;
      const tasks = readTaskList(teamName);
      if (tasks.length === 0) {
        return JSON.stringify({
          message: `No tasks found for team "${teamName}"`,
        });
      }
      return JSON.stringify(
        tasks.map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          owner: t.owner,
          priority: t.priority,
          description: t.description,
          blockedBy: t.blockedBy,
        })),
        null,
        2
      );
    }

    case "submit_queue_task": {
      const goal = input.goal as string;
      const projectPath =
        (input.project_path as string | undefined) ?? process.cwd();
      const priority = (input.priority as number | undefined) ?? 0;

      const task = await db.queuedTask.create({
        data: { goal, projectPath, priority },
      });
      return JSON.stringify({
        success: true,
        task: {
          id: task.id,
          goal: task.goal,
          projectPath: task.projectPath,
          status: task.status,
          priority: task.priority,
          createdAt: task.createdAt,
        },
      });
    }

    case "list_queue_tasks": {
      const statusFilter = input.status as string | undefined;
      const where: Record<string, unknown> =
        statusFilter && statusFilter !== "all"
          ? { status: statusFilter }
          : {};

      const tasks = await db.queuedTask.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 50,
      });

      return JSON.stringify(
        tasks.map((t) => ({
          id: t.id,
          goal: t.goal,
          projectPath: t.projectPath,
          status: t.status,
          priority: t.priority,
          teamName: t.teamName,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        })),
        null,
        2
      );
    }

    case "search_knowledge_base": {
      const query = (input.query as string).toLowerCase();
      const records = await db.indexedProject.findMany();

      const entries: KnowledgeBaseEntry[] = records
        .map((rec) => ({
          id: rec.id,
          path: rec.path,
          name: rec.name,
          tags: JSON.parse(rec.tags) as string[],
          lastScanned: rec.lastScanned?.toISOString() ?? undefined,
          source: "db" as const,
        }))
        .filter(
          (e) =>
            e.name.toLowerCase().includes(query) ||
            e.path.toLowerCase().includes(query) ||
            e.tags.some((tag) => tag.toLowerCase().includes(query))
        );

      return JSON.stringify(entries, null, 2);
    }

    case "get_knowledge_base_entry": {
      const id = input.id as number;
      const rec = await db.indexedProject.findUnique({ where: { id } });
      if (!rec) return JSON.stringify({ error: `Entry with ID ${id} not found` });

      const entry: KnowledgeBaseEntry = {
        id: rec.id,
        path: rec.path,
        name: rec.name,
        tags: JSON.parse(rec.tags) as string[],
        lastScanned: rec.lastScanned?.toISOString() ?? undefined,
        source: "db",
      };
      return JSON.stringify(entry, null, 2);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Mission Control Assistant, an AI helper for the Mission Control dashboard — a local tool for managing Claude Code agent teams, tracking token usage, and monitoring API costs.

You can help users with:
- **Team Management**: List active teams, check team health/status, view team members and their roles
- **Task Monitoring**: View tasks within teams, check task progress and statuses
- **Task Queue**: Submit new tasks to the automated queue, list queued tasks and their statuses
- **Knowledge Base**: Search registered projects, get project details

When answering:
- Be concise and helpful
- Use the available tools to fetch real-time data rather than guessing
- Format data clearly when presenting lists or statuses
- If a user asks to do something you can't do with your tools, explain what you can help with instead

You are running locally — there are no authentication concerns.`;

// ── Streaming chat handler ───────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const client = new Anthropic({ apiKey });

    // Build the message list for the API
    const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Create a readable stream for SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await processConversation(client, messages, controller, encoder);
        } catch (e) {
          const errorMsg =
            "Internal error";
          if (e instanceof Error) console.error("[chat] stream error:", e.message);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`)
          );
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    if (e instanceof Error) console.error("[chat] error:", e.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function processConversation(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  const MAX_TOOL_ROUNDS = 10;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Stream the response
    const stream = client.messages.stream({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    let hasToolUse = false;
    const toolUseBlocks: Anthropic.ContentBlock[] = [];
    let accumulatedText = "";

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if ("text" in delta && delta.text) {
          accumulatedText += delta.text;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "text", text: delta.text })}\n\n`
            )
          );
        }
      }
    }

    // Get the final message to check for tool use
    const finalMessage = await stream.finalMessage();

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        hasToolUse = true;
        toolUseBlocks.push(block);
      }
    }

    if (!hasToolUse) {
      // No tool calls — we're done
      break;
    }

    // Process tool calls and continue the conversation
    // Add assistant message with all content blocks
    messages.push({ role: "assistant", content: finalMessage.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "tool_use", tool: block.name })}\n\n`
        )
      );

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

    // Add tool results as user message
    messages.push({ role: "user", content: toolResults });
    // Loop to get the model's response to the tool results
  }
}
