# Chatbot Architecture

A conversational AI assistant embedded in the Mission Control dashboard, backed by Claude Sonnet, with tool-use capabilities for managing tasks, querying team status, and searching the knowledge base.

## Overview

The chatbot is a **floating panel** in the dashboard layout (not a separate page). It uses the Anthropic SDK's streaming messages API with tool use to answer questions and take actions on behalf of the user. Message history is kept **client-side only** (no new DB model) — conversations are ephemeral per session.

## API Design

### `POST /api/chat` — Streaming Chat Endpoint

**Request body:**
```typescript
{
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}
```

**Response:** Server-Sent Events (SSE) stream using the Anthropic SDK's streaming API. The route uses `new Response(readableStream)` with `Content-Type: text/event-stream`.

**Implementation approach:**
- Uses `@anthropic-ai/sdk` (already installed at ^0.76.0)
- Model: `claude-sonnet-4-6` (latest Sonnet)
- Uses Anthropic's native tool_use feature — the SDK handles tool calls and results internally
- The route implements a **tool execution loop**: when the model returns `tool_use` blocks, the server executes the tool, feeds back `tool_result`, and continues streaming until the model produces a final text response
- Stream text delta events to the client as SSE `data:` lines
- Final `data: [DONE]` sentinel signals stream end

**File:** `app/api/chat/route.ts`

## Tool Definitions

The chatbot has access to 5 tools, implemented as plain async functions in `lib/chat-tools.ts`:

### 1. `list_teams`
- **Description:** List all active agent teams with their health status and task progress
- **Parameters:** none
- **Implementation:** Calls the same logic as `GET /api/teams` — imports `listTeams()`, `readTaskList()`, `getTeamLastActivity()` from `lib/claude-files.ts`
- **Returns:** Array of `{ name, description, status, memberCount, taskStats: { total, completed, pending, inProgress } }`

### 2. `get_team_detail`
- **Description:** Get detailed info about a specific team including members, tasks, and health
- **Parameters:** `{ team_name: string }`
- **Implementation:** Reads team config from `~/.claude/teams/{name}/config.json`, reads task list, computes health
- **Returns:** Full team config + task list + health status

### 3. `submit_queue_task`
- **Description:** Submit a new task to the queue for automated agent execution
- **Parameters:** `{ goal: string, project_path?: string, priority?: number }`
- **Implementation:** Inserts into `QueuedTask` table via Prisma (same as `POST /api/queue`)
- **Returns:** `{ id, goal, status, createdAt }`

### 4. `list_queue_tasks`
- **Description:** List tasks in the queue with optional status filter
- **Parameters:** `{ status?: "pending" | "running" | "completed" | "failed" | "cancelled", limit?: number }`
- **Implementation:** Queries `QueuedTask` table via Prisma
- **Returns:** Array of queue tasks with status and metadata

### 5. `search_knowledge_base`
- **Description:** Search registered projects in the knowledge base by name or tags
- **Parameters:** `{ query?: string }`
- **Implementation:** Queries `IndexedProject` table, filters by name/tag match
- **Returns:** Array of `{ id, name, path, tags }`

## Tool Execution Flow

```
Client sends messages[] → POST /api/chat
  → Build Anthropic request with system prompt + tools + messages
  → Stream response from Claude
  → If response contains tool_use blocks:
      → Execute each tool server-side
      → Append tool_result messages
      → Call Claude again with updated messages (continue loop)
  → Stream final text response as SSE to client
  → Send [DONE] sentinel
```

The loop handles multi-step tool chains (e.g., "list teams then get details on the busiest one").

## System Prompt

```
You are Mission Control Assistant, an AI helper embedded in the Mission Control dashboard.
You help users manage their Claude Code agent teams, monitor task progress, and submit new work.

You have access to tools for:
- Listing and inspecting agent teams and their health/task status
- Submitting new tasks to the automated queue
- Searching the knowledge base of registered projects

Be concise and helpful. When showing team or task data, format it clearly.
When the user wants to submit a task, confirm the goal before submitting.
If a question doesn't require tools, answer directly from your knowledge.
```

## Component Structure

### Chat UI Components

```
components/chat/
├── chat-panel.tsx          # Floating panel (bottom-right), open/close toggle
├── chat-messages.tsx       # Message list with auto-scroll
├── chat-input.tsx          # Text input with send button
└── chat-message-bubble.tsx # Individual message bubble (user vs assistant styling)
```

### `chat-panel.tsx` — Main Container
- **Position:** Fixed bottom-right floating panel (like Intercom/Crisp style)
- **Toggle:** A floating button (MessageCircle icon from lucide-react) that opens/closes the panel
- **State:** `useState` for `isOpen`, `messages[]`, `isLoading`
- **Dimensions:** ~400px wide, ~500px tall, with resize handle
- **Renders in:** `app/(dashboard)/layout.tsx` alongside `<CommandPalette />`

### `chat-messages.tsx` — Message Display
- Renders user and assistant messages with distinct styling
- Auto-scrolls to bottom on new messages
- Shows a typing indicator (animated dots) while streaming
- Tool use is shown inline as a collapsible "action taken" block (e.g., "Searched knowledge base" with expandable results)

### `chat-input.tsx` — Input Area
- Textarea with auto-resize (max 4 lines)
- Send on Enter (Shift+Enter for newline)
- Disabled while streaming

### `chat-message-bubble.tsx` — Message Rendering
- User messages: right-aligned, accent background
- Assistant messages: left-aligned, muted background
- Supports markdown rendering for assistant responses
- Tool call results rendered as collapsible cards

## Client-Side State

Messages are stored in React state only — no persistence to DB or localStorage. Each page refresh starts a clean conversation. This keeps the implementation simple and avoids adding a new DB model.

```typescript
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }>;
  timestamp: Date;
}
```

## Integration Points

1. **Dashboard layout** (`app/(dashboard)/layout.tsx`): Add `<ChatPanel />` as a sibling to `<CommandPalette />`
2. **Anthropic SDK** (`@anthropic-ai/sdk`): Already a dependency — used for streaming messages with tool use
3. **API key**: Uses `ANTHROPIC_API_KEY` env var (same as team planner in `lib/team-planner.ts`)
4. **Database**: Reads from `QueuedTask`, `IndexedProject` via Prisma; writes to `QueuedTask` for task submission
5. **File system**: Reads team configs from `~/.claude/teams/` via `lib/claude-files.ts` helpers

## File Summary

| File | Type | Description |
|------|------|-------------|
| `app/api/chat/route.ts` | API Route | Streaming chat endpoint with tool execution loop |
| `lib/chat-tools.ts` | Server Lib | Tool definitions and execution functions |
| `components/chat/chat-panel.tsx` | Component | Floating chat panel container |
| `components/chat/chat-messages.tsx` | Component | Message list display |
| `components/chat/chat-input.tsx` | Component | Text input with send |
| `components/chat/chat-message-bubble.tsx` | Component | Individual message styling |
| `app/(dashboard)/layout.tsx` | Layout | Modified to include `<ChatPanel />` |

## Non-Goals (Kept Simple)

- **No DB persistence for chat history** — ephemeral, client-side only
- **No authentication** — Mission Control is a local-only tool
- **No file upload in chat** — use the queue page for attachments
- **No WebSocket** — SSE streaming matches the project's polling-based convention
- **No conversation branching/editing** — simple linear chat
