# Slack MCP Integration — Design Document

## Overview

This document defines the full API schema, database models, TypeScript interfaces, and MCP tool additions required to integrate Slack with Mission Control Lin. The integration enables users to:

1. Talk to the existing chatbot via Slack (DMs or a designated channel)
2. Manage tasks through Slack: submit queue tasks, check status, view teams, cancel tasks
3. Optionally use Slack slash commands for quick actions

The design follows existing project conventions: Prisma/SQLite for DB, `lib/api-helpers.ts` response wrappers (`ok`, `err`, `serverError`), `Preference` table for configuration, and Next.js App Router API routes.

---

## Architecture Overview

```
Slack Workspace
    │
    ├── Events API (app_mention, message.im)  ──►  POST /api/slack/events
    │                                                     │
    │                                                     ▼
    │                                              SlackEventHandler
    │                                              (verify signature, parse)
    │                                                     │
    │                                                     ▼
    │                                         /api/chatbot  (existing)
    │                                         (sends reply back to Slack)
    │
    └── Slash Commands (/mc-*)              ──►  POST /api/slack/slash
                                                       │
                                                       ▼
                                               SlashCommandRouter
                                               (quick actions without
                                                full chatbot loop)
```

Slack configuration (bot token, signing secret, channel mappings) is stored in the `SlackConfig` Prisma model. The admin manages configuration via `GET/PUT /api/slack/config`.

---

## 1. Database Schema Additions

Add to `prisma/schema.prisma`:

```prisma
/// Slack workspace integration configuration
model SlackConfig {
  id                Int      @id @default(autoincrement())
  workspaceId       String   @unique @map("workspace_id")   // Slack team_id, e.g. "T01ABC123"
  workspaceName     String?  @map("workspace_name")          // human-readable name
  botToken          String   @map("bot_token")               // xoxb-... OAuth token
  signingSecret     String   @map("signing_secret")          // for request signature verification
  defaultChannelId  String?  @map("default_channel_id")      // channel for proactive notifications
  dmUserId          String?  @map("dm_user_id")              // Slack user ID to DM for notifications
  enabled           Boolean  @default(true)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  channels          SlackChannelMap[]

  @@map("slack_configs")
}

/// Maps a Slack channel to a Mission Control context (team name, etc.)
model SlackChannelMap {
  id             Int         @id @default(autoincrement())
  slackConfig    SlackConfig @relation(fields: [slackConfigId], references: [id], onDelete: Cascade)
  slackConfigId  Int         @map("slack_config_id")
  channelId      String      @map("channel_id")              // Slack channel ID, e.g. "C01ABC123"
  channelName    String?     @map("channel_name")
  teamContext    String?     @map("team_context")             // optional: restrict chatbot to a specific MC team
  createdAt      DateTime    @default(now()) @map("created_at")

  @@unique([slackConfigId, channelId])
  @@map("slack_channel_maps")
}

/// Tracks Slack conversation threads to maintain context across replies
model SlackConversation {
  id               Int      @id @default(autoincrement())
  workspaceId      String   @map("workspace_id")
  channelId        String   @map("channel_id")
  threadTs         String?  @map("thread_ts")               // Slack thread timestamp (null = top-level)
  userId           String   @map("user_id")                 // Slack user who initiated
  /// JSON: Array<{ role: "user" | "assistant"; content: string }>
  messageHistory   String   @default("[]") @map("message_history")
  lastActivityAt   DateTime @default(now()) @map("last_activity_at")
  createdAt        DateTime @default(now()) @map("created_at")

  @@unique([workspaceId, channelId, threadTs])
  @@index([workspaceId, channelId])
  @@index([lastActivityAt])
  @@map("slack_conversations")
}
```

### Rationale for Model Design

- **`SlackConfig`** — one record per workspace. Stores secrets directly in SQLite (local-only deployment, same pattern as `anthropic_admin_api_key` in `Preference`). A single workspace is the common case; the model supports multiple via `workspaceId` unique constraint.
- **`SlackChannelMap`** — optional per-channel context binding. Without an entry, the chatbot responds in any channel it is mentioned in with no team context restriction.
- **`SlackConversation`** — maintains multi-turn conversation history per Slack thread, mirroring the `messages` array passed to `POST /api/chatbot`. Keyed on `(workspaceId, channelId, threadTs)`.

---

## 2. API Endpoints

### 2.1 `GET /api/slack/config`

Retrieve the current Slack configuration (tokens masked).

**Response `200`:**
```json
{
  "data": {
    "id": 1,
    "workspaceId": "T01ABC123",
    "workspaceName": "My Workspace",
    "botTokenMasked": "xoxb-...abc",
    "signingSecretMasked": "...xyz",
    "defaultChannelId": "C01ABC123",
    "dmUserId": "U01ABC123",
    "enabled": true,
    "channels": [
      { "id": 1, "channelId": "C01ABC123", "channelName": "mc-alerts", "teamContext": null }
    ]
  }
}
```

**Response `404` (not configured):**
```json
{ "error": "Slack not configured", "code": "NOT_FOUND" }
```

---

### 2.2 `PUT /api/slack/config`

Create or update Slack configuration. Supports upsert on `workspaceId`.

**Request body:**
```json
{
  "workspaceId": "T01ABC123",
  "workspaceName": "My Workspace",
  "botToken": "xoxb-...",
  "signingSecret": "abc123...",
  "defaultChannelId": "C01ABC123",
  "dmUserId": "U01ABC123",
  "enabled": true
}
```

**Response `200`:**
```json
{ "data": { "saved": true, "workspaceId": "T01ABC123" } }
```

**Validation errors `400`:**
```json
{ "error": "botToken is required", "code": "VALIDATION_ERROR" }
```

---

### 2.3 `DELETE /api/slack/config`

Remove Slack configuration entirely. Cascades to `SlackChannelMap` records. `SlackConversation` records are left for audit.

**Response `200`:**
```json
{ "data": { "deleted": true } }
```

---

### 2.4 `POST /api/slack/config/channels`

Add a channel mapping.

**Request body:**
```json
{
  "channelId": "C09XYZ789",
  "channelName": "general",
  "teamContext": "my-team"
}
```

**Response `201`:**
```json
{ "data": { "id": 2, "channelId": "C09XYZ789", "channelName": "general", "teamContext": "my-team" } }
```

---

### 2.5 `DELETE /api/slack/config/channels/[channelId]`

Remove a channel mapping by Slack channel ID.

**Response `200`:**
```json
{ "data": { "deleted": true } }
```

---

### 2.6 `POST /api/slack/events`

**This is the Slack Events API webhook.** Slack sends all workspace events here.

Must be publicly accessible (or tunneled via ngrok/cloudflare during development). Handles:

- **URL verification challenge** (one-time Slack handshake)
- **`app_mention`** — bot mentioned in a channel
- **`message.im`** — direct message to bot

**Security:** Every request must pass HMAC-SHA256 signature verification using `signingSecret` before processing.

**Request body (Slack URL verification):**
```json
{
  "type": "url_verification",
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P"
}
```

**Response `200` (challenge echo):**
```json
{ "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" }
```

**Request body (event callback):**
```json
{
  "type": "event_callback",
  "team_id": "T01ABC123",
  "event": {
    "type": "app_mention",
    "user": "U01ABC123",
    "text": "<@UBOTID> show me all teams",
    "ts": "1732100000.000100",
    "channel": "C01ABC123",
    "thread_ts": "1732100000.000100"
  }
}
```

**Response `200` (immediate ack — Slack requires response within 3 seconds):**
```json
{}
```

Processing is async: handler immediately returns `200`, then processes the message and calls Slack's `chat.postMessage` API to reply.

**Flow:**
1. Verify `X-Slack-Signature` header
2. Parse event type
3. Strip bot mention from text (for `app_mention`)
4. Load or create `SlackConversation` record for this `(workspaceId, channelId, threadTs)`
5. Append user message to history
6. Call `/api/chatbot` with accumulated `messages` array
7. Append assistant reply to history, persist
8. Send reply to Slack via `chat.postMessage`

---

### 2.7 `POST /api/slack/slash`

**Slack slash command handler.** Handles `/mc-*` commands for quick, stateless actions that don't need the full chatbot agentic loop.

Slack sends form-encoded POST body. Must respond within 3 seconds (use `response_url` for delayed responses).

**Slack request body (form-encoded):**
```
command=/mc-status
text=
user_id=U01ABC123
channel_id=C01ABC123
team_id=T01ABC123
response_url=https://hooks.slack.com/commands/...
```

**Supported commands:**

| Command | Description |
|---|---|
| `/mc-status` | Dashboard stats: team count, queue depth, worker status |
| `/mc-teams` | List all active teams |
| `/mc-queue [status]` | List queue tasks, optionally filtered by status |
| `/mc-task <goal>` | Submit a new queue task |
| `/mc-cancel <taskId>` | Cancel a queued task |
| `/mc-help` | Show available commands |

**Response `200` (immediate Slack response):**
```json
{
  "response_type": "in_channel",
  "text": "Queue depth: 3 pending, 1 running",
  "blocks": [...]
}
```

Slash commands respond immediately with pre-formatted Slack Block Kit payloads for rich display.

---

### 2.8 `GET /api/slack/status`

Returns current integration health: whether Slack is configured, whether the bot token is valid, and recent event counts.

**Response `200`:**
```json
{
  "data": {
    "configured": true,
    "enabled": true,
    "workspaceId": "T01ABC123",
    "workspaceName": "My Workspace",
    "botTokenValid": true,
    "recentConversations": 5,
    "lastEventAt": "2026-02-18T12:00:00.000Z"
  }
}
```

---

## 3. TypeScript Interfaces

Add to `types/index.ts`:

```typescript
// ── Slack Integration Types ──────────────────────────────────────────────────

export interface SlackConfig {
  id: number;
  workspaceId: string;
  workspaceName?: string | null;
  /** Masked — last 4 characters shown, e.g. "xoxb-...abc" */
  botTokenMasked?: string;
  /** Masked — last 4 characters shown */
  signingSecretMasked?: string;
  defaultChannelId?: string | null;
  dmUserId?: string | null;
  enabled: boolean;
  channels: SlackChannelMap[];
  createdAt: string;
  updatedAt: string;
}

export interface SlackChannelMap {
  id: number;
  channelId: string;
  channelName?: string | null;
  /** If set, chatbot responses in this channel are scoped to this team */
  teamContext?: string | null;
  createdAt: string;
}

export interface SlackConversation {
  id: number;
  workspaceId: string;
  channelId: string;
  threadTs?: string | null;
  userId: string;
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
  lastActivityAt: string;
  createdAt: string;
}

// ── Slack API Request/Response Shapes ────────────────────────────────────────

/** Request body for PUT /api/slack/config */
export interface UpsertSlackConfigRequest {
  workspaceId: string;
  workspaceName?: string;
  botToken: string;
  signingSecret: string;
  defaultChannelId?: string;
  dmUserId?: string;
  enabled?: boolean;
}

/** Request body for POST /api/slack/config/channels */
export interface AddSlackChannelRequest {
  channelId: string;
  channelName?: string;
  teamContext?: string;
}

/** Slack Events API payload — url_verification */
export interface SlackUrlVerificationEvent {
  type: "url_verification";
  token: string;
  challenge: string;
}

/** Slack Events API payload — event_callback */
export interface SlackEventCallback {
  type: "event_callback";
  team_id: string;
  api_app_id: string;
  event: SlackEvent;
  event_id: string;
  event_time: number;
}

export type SlackEventPayload = SlackUrlVerificationEvent | SlackEventCallback;

/** Union of handled Slack event types */
export type SlackEvent = SlackAppMentionEvent | SlackMessageImEvent;

export interface SlackAppMentionEvent {
  type: "app_mention";
  user: string;
  text: string;
  ts: string;
  channel: string;
  thread_ts?: string;
}

export interface SlackMessageImEvent {
  type: "message";
  subtype?: string;
  channel_type: "im";
  user: string;
  text: string;
  ts: string;
  channel: string;
  thread_ts?: string;
}

/** Slack slash command POST body (form-encoded, parsed) */
export interface SlackSlashCommandPayload {
  command: string;         // e.g. "/mc-status"
  text: string;            // args after the command
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  team_id: string;
  team_domain: string;
  response_url: string;   // for delayed responses
  trigger_id: string;
}

/** Response shape for slash commands (Slack Block Kit compatible) */
export interface SlackSlashCommandResponse {
  response_type: "in_channel" | "ephemeral";
  text: string;
  blocks?: SlackBlock[];
}

/**
 * Minimal Slack Block type — enough for section and context blocks.
 * Full Block Kit spec at https://api.slack.com/reference/block-kit/blocks
 */
export interface SlackBlock {
  type: "section" | "context" | "divider" | "header";
  text?: { type: "mrkdwn" | "plain_text"; text: string };
  fields?: Array<{ type: "mrkdwn" | "plain_text"; text: string }>;
  elements?: Array<{ type: "mrkdwn" | "plain_text"; text: string }>;
}

/** Response body for GET /api/slack/status */
export interface SlackIntegrationStatus {
  configured: boolean;
  enabled: boolean;
  workspaceId?: string;
  workspaceName?: string;
  botTokenValid?: boolean;
  recentConversations?: number;
  lastEventAt?: string | null;
}
```

---

## 4. MCP Tool Additions

The existing MCP server (`server/mcp-server.ts`) exposes tools for Claude Code leader agents running in tmux. The Slack integration does **not** require new MCP tools at this stage because:

- The chatbot (`/api/chatbot`) already has all necessary tools for Slack to call.
- The Slack event handler calls `/api/chatbot` as an internal HTTP request.
- Leader agents in tmux don't need to interact with Slack directly.

**However**, one optional MCP tool is worth adding for future agent-to-Slack notification flows:

```typescript
// Addition to server/mcp-server.ts — tool definition
{
  name: "SendSlackMessage",
  description:
    "Send a message to a Slack channel or user via the configured Slack bot. " +
    "Use this to proactively notify humans about important events (task completion, errors, decisions needed).",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "Slack channel ID (e.g. C01ABC123) or user ID for DM (e.g. U01ABC123)",
      },
      text: {
        type: "string",
        description: "Message text to send (plain text or Slack mrkdwn format)",
      },
    },
    required: ["channel_id", "text"],
  },
}
```

This tool would call `POST /api/slack/send` (a new internal-only endpoint) which uses the stored bot token to call Slack's `chat.postMessage` API.

**New internal endpoint: `POST /api/slack/send`**

```
Request body: { channelId: string; text: string }
Response: { data: { ts: string; channelId: string } }  — Slack message timestamp
```

This endpoint is internal (not exposed to Slack) and only called by the MCP tool or programmatically.

---

## 5. Slack App Setup (User-Facing Instructions)

The user needs to create a Slack App with these settings:

### Required Bot Token Scopes
- `chat:write` — send messages
- `app_mentions:read` — receive app_mention events
- `im:read` / `im:write` — direct messages
- `commands` — slash commands

### Event Subscriptions
- Enable Events API
- Request URL: `https://<your-host>/api/slack/events`
- Subscribe to bot events: `app_mention`, `message.im`

### Slash Commands
Add these commands pointing to `https://<your-host>/api/slack/slash`:
- `/mc-status`
- `/mc-teams`
- `/mc-queue`
- `/mc-task`
- `/mc-cancel`
- `/mc-help`

### Environment / Local Development
For local use, a tunnel is needed to expose the Next.js server:

```bash
# Option 1: cloudflared
cloudflared tunnel --url http://localhost:3777

# Option 2: ngrok
ngrok http 3777
```

The tunnel URL is used as the base URL in the Slack App settings.

---

## 6. Conversation Thread Pruning

`SlackConversation.messageHistory` grows unbounded as users chat. Two pruning strategies:

1. **Cap at N messages**: Keep only the last 20 message pairs (40 entries) when persisting. Oldest messages are dropped.
2. **Session expiry**: Conversations with `lastActivityAt` older than 24 hours are treated as new (empty history), preventing stale context bleed.

The pruning logic lives in the event handler, not the DB layer.

---

## 7. Security Considerations

### Slack Request Signature Verification
Every `POST /api/slack/events` and `POST /api/slack/slash` request must pass HMAC-SHA256 verification:

```typescript
// Pseudo-code for verification middleware
const timestamp = req.headers['x-slack-request-timestamp'];
const signature = req.headers['x-slack-signature'];
const body = await req.text(); // raw body before parsing

// Reject stale requests (replay protection)
if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
  return err("Stale request", "UNAUTHORIZED", 401);
}

const sigBase = `v0:${timestamp}:${body}`;
const computed = 'v0=' + hmacSha256(signingSecret, sigBase);
if (!timingSafeEqual(computed, signature)) {
  return err("Invalid signature", "UNAUTHORIZED", 401);
}
```

### Token Storage
Bot tokens and signing secrets are stored in plaintext in SQLite (consistent with how `anthropic_admin_api_key` is stored). This is acceptable for a local-only dashboard. If deployed remotely, encrypt at rest.

### Bot Mention Stripping
Strip `<@UBOTID>` from `app_mention` event text before passing to the chatbot. Validate that the mention user ID matches the bot's own user ID to prevent spoofing.

---

## 8. File Structure

New files to create:

```
app/api/slack/
├── config/
│   ├── route.ts              # GET, PUT, DELETE /api/slack/config
│   └── channels/
│       └── [channelId]/
│           └── route.ts      # DELETE /api/slack/config/channels/[channelId]
├── config/channels/route.ts  # POST /api/slack/config/channels
├── events/
│   └── route.ts              # POST /api/slack/events (webhook)
├── send/
│   └── route.ts              # POST /api/slack/send (internal)
├── slash/
│   └── route.ts              # POST /api/slack/slash
└── status/
    └── route.ts              # GET /api/slack/status

lib/
└── slack-client.ts           # Slack API client wrapper (chat.postMessage, etc.)

components/settings/
└── slack-config-form.tsx     # UI for entering bot token + signing secret
```

---

## 9. Summary of Changes

| Area | Change |
|---|---|
| `prisma/schema.prisma` | Add `SlackConfig`, `SlackChannelMap`, `SlackConversation` models |
| `types/index.ts` | Add all Slack-related TypeScript interfaces |
| `app/api/slack/` | New directory with 6 route handlers |
| `lib/slack-client.ts` | New utility: wraps Slack Web API (`chat.postMessage`) |
| `server/mcp-server.ts` | Optional: add `SendSlackMessage` tool |
| `app/api/slack/send/route.ts` | Optional: internal endpoint for MCP-triggered Slack sends |
| `components/settings/` | Optional: settings UI for Slack configuration |

No changes are required to the existing chatbot route (`app/api/chatbot/route.ts`) — the Slack event handler calls it as an internal API consumer, passing accumulated conversation history.
