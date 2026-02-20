# Mission Control Lin

Local dashboard for managing Claude Code agent teams, tracking token usage, and monitoring API costs. Built with Next.js, Prisma/SQLite, and tmux.

## Tech Stack
- **Framework**: Next.js 16.1.6 (App Router), React 19
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Database**: SQLite via Prisma ORM 7 + better-sqlite3 (fully local)
- **Charts**: Recharts
- **Tables**: @tanstack/react-table
- **Process Management**: tmux (agent spawning/monitoring)
- **AI**: Anthropic SDK (team planning via `lib/team-planner.ts`)
- **Auth**: next-auth + Claude OAuth (`lib/claude-oauth.ts`)
- **Proxy**: Node HTTP proxy for API request interception
- **MCP**: Model Context Protocol server for agent tool exposure (`server/mcp-server.ts`)
- **Task Queue**: Standalone background worker (`server/queue-worker.ts`) for automated agent execution
- **Slack**: @slack/web-api + @slack/socket-mode for workspace integration (`lib/slack.ts`, `lib/slack-socket.ts`)
- **Self-Healing**: Automated compilation error detection and repair (`lib/self-healer.ts`)
- **File Watching**: chokidar for filesystem change monitoring (`server/file-watcher.ts`)
- **Testing**: Vitest 4 (unit + integration tests in `__tests__/` and co-located `lib/slack-socket.test.ts`)
- **Validation**: Zod

## Quick Start
```bash
pnpm install        # deps + auto-registers MCP server in .claude/settings.json
npx prisma generate
pnpm dev            # Next.js on :31777
pnpm proxy          # API proxy on :28787 (optional, for proxy-based token tracking)
pnpm queue:daemon   # Queue worker in persistent tmux session (recommended)
# pnpm queue        # Queue worker in foreground (dies on terminal close)
# pnpm dev:all      # prisma generate + all servers via scripts/start-all.sh
```

### MCP Setup (automatic)
`pnpm install` runs `scripts/setup-mcp.js` (postinstall), which generates
`.claude/settings.json` from `.claude/settings.base.json` and injects the
absolute path to `scripts/mcp-server.sh` for the current machine.

- `.claude/settings.base.json` — committed to git; contains permissions + `teammateMode`
- `.claude/settings.json` — gitignored; generated on every `pnpm install` with machine-specific MCP path
- Re-run `pnpm mcp:setup` if the project directory moves

The MCP server exposes `TeamCreate`, `TeamDelete`, and `SendMessage` to all
Claude Code leader agents spawned by the queue worker.

## Project Structure
```
app/
├── (dashboard)/
│   ├── page.tsx              # Overview — stat cards, activity feed
│   ├── agent-teams/          # Team listing, creation, detail views
│   │   └── [name]/page.tsx   # Individual team (live-updating)
│   ├── analytics/page.tsx    # Token usage, model/team/member breakdowns, proxy status banner
│   ├── knowledge-base/       # Registered project directory browser
│   │   └── [id]/page.tsx     # Individual project detail view
│   ├── queue/page.tsx        # Task queue — submit and monitor queued tasks
│   ├── roles/page.tsx        # Team member role management (presets + custom)
│   ├── chatbot/page.tsx      # AI chatbot assistant interface
│   ├── self-healing/page.tsx # Compilation error detection + auto-repair dashboard
│   ├── stuck/page.tsx        # Stuck task detection across all teams
│   └── settings/page.tsx     # Theme, refresh interval, proxy config, admin API key, OAuth
├── api/
│   ├── teams/                # CRUD, smart-create, spawn, stuck
│   │   └── [name]/           # health, wake, shutdown, sessions, message, background
│   │       └── tasks/        # task CRUD + reorder; [id]/respond for stuck-task actions
│   ├── analytics/            # Daily aggregation, by-model, by-team, by-member, by-task, by-repo, ingest, usage-summary
│   ├── usage/                # Anthropic Admin API sync: sync, status, summary, by-model, by-workspace, claude-code
│   ├── queue/                # Task queue CRUD + file attachment upload
│   │   ├── status/           # Worker heartbeat + queue depth summary
│   │   ├── worker/           # Start/stop/inspect the mc-queue-worker tmux session
│   │   └── [id]/attachments/ # Per-task attachment list; [filename] for serve/delete
│   ├── roles/                # Team member role CRUD; [id] for individual role update/delete
│   ├── chat/                 # Streaming chat completions; sessions/ CRUD; sessions/[id] for individual session
│   ├── chatbot/              # Chatbot endpoint (simple Q&A)
│   ├── build/                # Trigger builds programmatically
│   ├── compilation-errors/   # Error detection (detect/), CRUD, [id]/heal for auto-fix
│   ├── self-healing/         # Self-healing dashboard: list, stats/, [id]/ detail, [id]/heal trigger
│   ├── slack/                # Slack integration: config/, slash/, events/, manifest/
│   ├── skills/               # MCP skill registry
│   ├── dashboard/stats/      # Overview metrics
│   ├── proxy/                # Proxy status (GET /status) and control (POST /control: start|stop)
│   ├── proxy-logs/           # Request logging (GET list with filters, POST insert)
│   ├── settings/             # User preferences (GET/PUT); usage-limits (GET/PUT); oauth (GET/POST/DELETE)
│   ├── knowledge-base/       # Knowledge base entries (GET list, POST add, [id] CRUD)
│   ├── projects/             # Indexed project management (same DB as knowledge-base)
│   └── activity/             # Activity feed
└── layout.tsx                # Root layout (fonts, theme, toaster)

components/
├── agent-teams/              # Team cards, health panels, dialogs, task forms, background config
├── analytics/                # Charts, tables, ingest button, usage limits card, proxy status banner, repo usage chart, request log table
├── chat/                     # Chat UI primitives: input, messages, panel, session list, tool results
├── chatbot/                  # Chatbot assistant interface (chat-interface.tsx)
├── dashboard/                # Stat cards, activity feed, quick actions, stuck teams summary
├── knowledge-base/           # Project path management, skills section and tab
├── layout/                   # Sidebar, topbar, command palette, breadcrumbs
├── queue/                    # Queue UI components (role-picker)
├── settings/                 # Settings form
├── stuck/                    # Stuck task feed, filter bar, stuck page client
├── theme-provider.tsx        # Dark/light theme (next-themes)
└── ui/                       # shadcn/ui primitives

lib/
├── db.ts                     # Prisma client singleton
├── claude-files.ts           # Read/write ~/.claude/ (teams, tasks, settings, archive)
├── team-spawner.ts           # Team spawn logic (config + tasks + leader launch)
├── team-planner.ts           # AI-assisted team plan generation (smart-create)
├── tmux-manager.ts           # tmux session lifecycle
├── agent-launcher.ts         # Build prompts, launch agents in tmux
├── anthropic-usage.ts        # Admin API client: fetchUsageReport, fetchCostReport, fetchClaudeCodeReport, syncUsageData
├── pricing.ts                # MODEL_PRICING table, computeCost()
├── proxy-manager.ts          # Singleton proxy child-process manager: spawnProxyProcess(), killProxyProcess(), isProxyRunning()
├── api-helpers.ts            # ok(), created(), err(), notFound(), serverError() + safeName(), validateProjectPath(), validateUrl()
├── analytics-helpers.ts      # getCutoffDate(), period parsing, UNTRACKED_TEAM_LABEL constant
├── sleep-detector.ts         # System sleep detection for session checkpoints
├── claude-oauth.ts           # Claude OAuth authentication helpers
├── slack.ts                  # Slack Web API integration (notifications, channel messaging)
├── slack-commands.ts         # Slack slash command handlers
├── slack-socket.ts           # Slack Socket Mode real-time connection
├── self-healer.ts            # Compilation error auto-repair logic
├── settings-context.tsx      # React context for user settings
├── hooks/use-auto-refresh.ts # Client-side polling hook
└── utils.ts                  # cn() class merge

server/
├── proxy.ts                  # HTTP proxy — intercepts Anthropic API, extracts tokens (exports extractUsage, extractUsageFromSSE, isStreamingRequest)
├── start-proxy.ts            # Proxy entry point
├── mcp-server.ts             # MCP stdio server (TeamCreate/TeamDelete/SendMessage tools)
├── queue-worker.ts           # Background queue processor — AI planning + team spawn + monitoring
├── start-queue-worker.ts     # Queue worker entry point
└── file-watcher.ts           # File change monitoring (auto-started via instrumentation.ts on server boot)

scripts/
├── setup-mcp.js              # Postinstall: patches .claude/settings.json with absolute MCP server path
├── mcp-server.sh             # Shell wrapper to launch the MCP stdio server
├── start-all.sh              # Starts all servers (Next.js + queue worker) — used by pnpm dev:all
├── start-queue-daemon.sh     # Launches queue worker in a persistent tmux session
├── queue-daemon-inner.sh     # Inner script executed inside the daemon tmux session
└── monitor-queue.sh          # Monitors queue worker heartbeat and restarts if stale (run directly: bash scripts/monitor-queue.sh)

prisma/
├── schema.prisma             # All DB models (see Database Models section)
└── mission-control.db        # SQLite database (gitignored: no)

__tests__/                    # Vitest test suite
├── api/                      # End-to-end API integration tests (e.g., e2e-proxy-enabled-analytics.test.ts)
├── components/               # Component tests
├── helpers/                  # Test helper utilities (usage-api-mocks.ts)
├── lib/                      # Unit tests for lib modules
├── theme/                    # Theme-related tests (light-mode.test.ts)
├── types/                    # Type-level tests
├── proxy-extraction.test.ts  # Proxy SSE/JSON extraction tests
└── usage-api.test.ts         # Anthropic Usage API integration tests
# Note: co-located lib test: lib/slack-socket.test.ts

docs/
├── usage-api-spec.md                  # Anthropic Usage/Cost API integration specification
├── architecture-team-member-roles.md  # Team member roles system design
├── chatbot-architecture.md            # Chatbot assistant architecture
├── self-healing-build-errors.md       # Self-healing compilation errors design
├── slack-integration-design.md        # Slack workspace integration design
└── repo-analytics-plan.md             # Per-repo analytics tracking plan

types/index.ts                # All shared interfaces (Team, Teammate, Analytics, Usage, etc.)
instrumentation.ts            # Next.js server instrumentation — auto-starts file-watcher on server boot
Procfile                      # Process declarations: web (pnpm dev) + worker (pnpm queue)
```

## Database Models (prisma/schema.prisma)
- **ProxyLog** — per-request record: model, tokens (input/output/cacheRead/cacheCreation), team/member/repo, endpoint, latencyMs, statusCode
- **AnalyticsSnapshot** — daily aggregated cost/token totals by model
- **IndexedProject** — registered project paths with name and tags (DB-only; no filesystem auto-population)
- **Preference** — key-value settings store (theme, refreshInterval, admin API key, usage limits)
- **QueuedTask** — task queue entries with goal, projectPath, status, priority, result, file attachments (JSON), and teamMembers (JSON array of selected roles)
- **TeamMemberRole** — user-defined and preset agent roles with name, role title, agentType, and description; used for team composition
- **UsageRecord** — billing-accurate token data synced from Anthropic Usage API (per bucket/model/workspace/serviceTier)
- **CostRecord** — billing-accurate cost data synced from Anthropic Cost API (daily, per model/costType/tokenType)
- **ClaudeCodeDailyMetric** — per-user daily productivity metrics from Anthropic Claude Code Analytics API
- **UsageSyncCursor** — tracks incremental sync position for each data source (usage, cost, claude_code)
- **SessionCheckpoint** — captures team state (task statuses, pane content, member liveness) before sleep for auto-resume
- **ChatSession** — chat assistant sessions with title and timestamps; has many ChatMessages
- **ChatMessage** — individual chat messages with role (user/assistant), content, optional toolCalls/toolResults (JSON)
- **SlackConfig** — Slack workspace integration: workspaceId, botToken, signingSecret, appToken, channelId
- **CompilationError** — tracked compilation errors with errorType, status (pending/healing/healed/failed/skipped), healingStrategy, resolution; has many HealingAttempts
- **HealingAttempt** — individual auto-repair attempt for a CompilationError: strategy, patch (JSON), buildOutput, success flag, durationMs

## Key Architectural Patterns

### Agent Team Lifecycle
1. **Plan**: `POST /api/teams/smart-create` — AI generates team plan (personas + tasks) via `lib/team-planner.ts`
2. **Spawn**: `POST /api/teams/spawn` — creates `~/.claude/teams/{name}/` config, launches leader tmux session via `lib/team-spawner.ts`
   - Leader is the only tmux session; teammates are spawned as subagents inside the leader's process
   - Setup message instructs leader to call `TeamCreate` (via MCP) then spawn all teammates via `Task` tool
   - `sourceTaskId` field in config links team to a `QueuedTask` to prevent duplicate teams per queued task
3. **Monitor**: `GET /api/teams/[name]/health` — checks tmux process liveness + task staleness
   - Health statuses: `alive` (tmux running or recent activity), `asleep` (no activity >5 min), `completed` (all tasks done), `exited` (archived)
   - Returns `taskStats: { total, completed, pending, inProgress }` per team
   - Calls `detectSleep()` on each poll — detects system sleep via wall-clock gap >2 min between polls
4. **Wake**: `POST /api/teams/[name]/wake` — restarts dead sessions, sends resume message
5. **Message**: `POST /api/teams/[name]/message` — send an ad-hoc message into the leader tmux pane
6. **Background**: `GET/POST /api/teams/[name]/background` — configure background execution (sleep prevention, auto-wake)
   - Persistent teams: auto-woken after sleep detection, up to `maxWakeRetries` attempts
7. **Complete**: When all tasks reach `completed`/`deleted` status, health auto-transitions to `"completed"`
8. **Auto-archive**: Completed teams with dead leader + >5 min inactivity are auto-archived on next listing
9. **Shutdown**: `GET /api/teams/[name]/shutdown` — sends shutdown request to teammates
10. **Archive**: `DELETE /api/teams/[name]?mode=archive` — moves to `~/.claude/teams-archive/`

### Task Queue
- `QueuedTask` records stored in SQLite with status: `pending | running | completed | failed | cancelled`
- Queue worker (`server/queue-worker.ts`) polls the table and auto-spawns teams for pending tasks
- File attachments (images, PDFs, text, up to 10 MB, max 5 per task) stored server-side and linked to tasks
- Queue page (`app/(dashboard)/queue/`) provides full task management UI with status tracking
- `POST /api/queue` — create task; `GET /api/queue` — list tasks; `PATCH /api/queue/[id]` — update; `DELETE /api/queue/[id]` — cancel
- `POST /api/queue/upload` — upload file attachment, returns stored filename
- `GET /api/queue/status` — worker heartbeat freshness, queue depth, and per-status counts (pending/running/completed/failed)
- `GET /api/queue/worker` — inspect whether `mc-queue-worker` tmux session is alive and heartbeat is fresh
- `POST /api/queue/worker` — start (or restart) the queue worker in a persistent tmux daemon session
- `DELETE /api/queue/worker` — kill the `mc-queue-worker` tmux session
- `GET /api/queue/[id]/attachments` — list attachments for a task
- `GET /api/queue/[id]/attachments/[filename]` — serve attachment file inline (path-traversal protected)
- `DELETE /api/queue/[id]/attachments/[filename]` — delete attachment from disk and DB

### Task Management (within teams)
- `GET /api/teams/[name]/tasks` — list all tasks (ordered by `order` field)
- `PATCH /api/teams/[name]/tasks/[id]` — update task fields: status, owner, subject, description, priority, order, blockedBy, blocks, metadata
  - Valid statuses: `pending | in_progress | completed | deleted`
  - Valid priorities: `low | medium | high | urgent`
- `PATCH /api/teams/[name]/tasks/reorder` — reorder tasks by providing ordered `taskIds` array; assigns `order` as multiples of 10
- `POST /api/teams/[name]/tasks/[id]/respond` — act on a stuck/blocked task:
  - `action: "message"` — sends message to task owner's inbox and clears blocker metadata
  - `action: "reassign"` — reassigns task to another team member (`assignTo`) and notifies via inbox
  - `action: "cancel"` — marks task as `deleted` and notifies the owner

### Stuck Task Detection
- `GET /api/teams/stuck` — scans all active teams for tasks that have been `in_progress` beyond a threshold
- Stuck page (`app/(dashboard)/stuck/`) surfaces blocked/stalled tasks across all teams with filter controls
- `StuckTask` type extends `TeamTask` with `blockerType`, `blockerSummary`, `blockerDetails`, and `blockerSince` fields
- Resolve stuck tasks via `POST /api/teams/[name]/tasks/[id]/respond` (message, reassign, or cancel)

### MCP Server
- `server/mcp-server.ts` exposes `TeamCreate`, `TeamDelete`, and `SendMessage` tools via MCP stdio protocol
- Allows Claude leader agents to manage team directories and send messages without HTTP calls
- Run via `pnpm mcp`; typically configured as a Claude Code MCP server entry

### Background Execution
- `lib/sleep-detector.ts` detects system sleep/wake events for macOS
- `SessionCheckpoint` DB records capture team state (task statuses, pane content, member liveness) before sleep
- `BackgroundConfig` in team config controls: `persistent`, `wakeStrategy` (immediate/scheduled), `wakeDelaySeconds`, `maxWakeRetries`
- Background status surfaced in team health panel via `backgroundExecution` field on `TeamHealth`

### Analytics Endpoints (Proxy-Based Data)
- `GET /api/analytics?period=7d|30d|all` — daily token totals from proxy logs, grouped by day
- `GET /api/analytics/by-model?period=...` — tokens/cost grouped by model
- `GET /api/analytics/by-team?period=...` — tokens/cost grouped by team (null teamName becomes "untracked")
- `GET /api/analytics/by-member?period=...&team=name` — tokens/cost per team member
- `GET /api/analytics/by-task?period=...` — per-team/member token attribution with `"exact"` or `"team-level"` flag
- `GET /api/analytics/by-repo?period=...` — tokens/cost grouped by repository name
- `GET /api/analytics/usage-summary` — daily + monthly totals with configured usage limits from Preferences
- `POST /api/analytics/ingest` — bulk-ingest analytics snapshots

### Token Tracking (Proxy-Based)
- Proxy server (`server/proxy.ts`) intercepts Anthropic API requests on port 28787
- Exports `extractUsage()` (non-streaming JSON), `extractUsageFromSSE()` (streaming SSE), `isStreamingRequest()` for testability
- Extracts tokens from JSON responses or SSE streams (`message_start`/`message_delta`)
- Records to SQLite via direct better-sqlite3 (not Prisma, for performance)
- Custom headers `x-claude-team` / `x-claude-member` for attribution
- `lib/proxy-manager.ts` — module-level singleton managing the proxy child process:
  - `spawnProxyProcess(port, targetUrl)` — spawns `server/proxy.ts` via `npx tsx`; no-ops if already running
  - `killProxyProcess()` — sends SIGTERM; no-ops if not running
  - `isProxyRunning()` / `getProxyProcess()` — status accessors
  - Used by both `PUT /api/settings` (auto-start on save) and `POST /api/proxy/control` (manual toggle), sharing the same handle to prevent duplicate processes
- `GET /api/proxy/status` — TCP port probe to check if proxy is running; returns `{ running, port, targetUrl }`
- `POST /api/proxy/control` — manually `{ action: "start" }` or `{ action: "stop" }` the proxy process
- `components/analytics/proxy-status-banner.tsx` — renders at top of analytics dashboard:
  - Full banner when proxy is off: step-by-step instructions, copy button for `ANTHROPIC_BASE_URL` env var, link to Settings
  - Active banner when proxy is on: shows port, confirms live capture
  - Compact mode (`compact` prop): small inline dot-indicator for embedding elsewhere

### Token Tracking (Anthropic Admin API)
- `lib/anthropic-usage.ts` provides `fetchUsageReport`, `fetchCostReport`, `fetchClaudeCodeReport`, and `syncUsageData`
- Admin API key stored in `Preference` table (key: `anthropic_admin_api_key`) or env var `ANTHROPIC_ADMIN_API_KEY`
- `POST /api/usage/sync` — triggers incremental sync from Anthropic Usage, Cost, and Claude Code Analytics APIs
- `GET /api/usage/status` — returns sync status and key configuration state
- `GET /api/usage/summary` — daily aggregated token + cost totals (supports `?period=7d|30d|1m|all&source=api|proxy|all`)
- `GET /api/usage/by-model` — per-model token and cost breakdown
- `GET /api/usage/by-workspace` — per-Anthropic-workspace breakdown
- `GET /api/usage/claude-code` — Claude Code productivity metrics (sessions, LOC, commits, PRs, tool accept rates)
- All sync operations are idempotent via unique constraints; `UsageSyncCursor` tracks incremental position per source

### Team Member Roles
- `TeamMemberRole` DB model stores reusable agent role definitions (preset and user-created)
- `GET /api/roles` — list all roles; `POST /api/roles` — create new role
- `PATCH /api/roles/[id]` — update role; `DELETE /api/roles/[id]` — delete (presets protected)
- Roles page (`app/(dashboard)/roles/`) provides management UI
- `QueuedTask.teamMembers` JSON field stores selected role IDs or inline role objects for team composition
- `components/queue/role-picker.tsx` — role selection widget embedded in queue task creation form

### Chat / Chatbot
- `ChatSession` + `ChatMessage` DB models provide persistent conversation storage
- Chat API (`/api/chat`) supports streaming completions via Anthropic SDK
- Session management: `GET/POST /api/chat/sessions`, `GET/DELETE /api/chat/sessions/[id]`
- Chatbot page (`app/(dashboard)/chatbot/`) provides conversational AI interface
- Components in `components/chat/` (panel, messages, input, session list, tool results) and `components/chatbot/` (chat-interface)

### Slack Integration
- `SlackConfig` DB model stores workspace credentials (botToken, signingSecret, appToken, channelId)
- `GET/POST /api/slack/config` — manage Slack workspace configuration
- `POST /api/slack/slash` — handle Slack slash commands (via `lib/slack-commands.ts`)
- `POST /api/slack/events` — receive Slack Events API webhooks
- `GET /api/slack/manifest` — generate Slack app manifest for easy installation
- `lib/slack.ts` — Web API client for sending notifications and channel messages
- `lib/slack-socket.ts` — Socket Mode connection for real-time Slack interaction

### Self-Healing Build Errors
- `CompilationError` + `HealingAttempt` DB models track errors and repair attempts
- `POST /api/compilation-errors/detect` — scan a project for compilation errors
- `GET /api/compilation-errors` — list detected errors; `PATCH/DELETE /api/compilation-errors/[id]`
- `POST /api/compilation-errors/[id]/heal` — trigger auto-repair for a specific error
- `GET /api/self-healing` — dashboard overview; `GET /api/self-healing/stats` — aggregate stats
- `GET /api/self-healing/[id]` — detail view; `POST /api/self-healing/[id]/heal` — trigger heal
- `lib/self-healer.ts` — core logic for analyzing errors and generating fixes
- `POST /api/build` — trigger builds programmatically (used by self-healing pipeline)
- Self-healing page (`app/(dashboard)/self-healing/`) provides monitoring dashboard

### File-Based State (not in DB)
- Team configs: `~/.claude/teams/{name}/config.json`
- Task lists: `~/.claude/tasks/{name}/{id}.json`
- Team inboxes: `~/.claude/teams/{name}/inboxes/{member}.json` (for MCP SendMessage)
- Background config: `~/.claude/teams/{name}/background.json` (persistent execution settings)
- Sleep detection: `~/.claude/teams/{name}/last-poll.json` (last poll timestamp)
- Archived teams: `~/.claude/teams-archive/{name}/`
- Archived tasks: `~/.claude/tasks-archive/{name}/`
- Queue worker heartbeat: `~/.claude/queue-worker.heartbeat`
- Managed by `lib/claude-files.ts` with path traversal protection
- Archive via `archiveTeam()` — copies config with `archivedAt` timestamp, moves dirs

### API Response Convention
All API routes return: `{ data?, error?, meta? }` via helpers in `lib/api-helpers.ts`

## Testing
- **Framework**: Vitest 4 with `globals: true`; configured in `vitest.config.ts` with `@` alias pointing to project root
- **Test locations**: `__tests__/` (api, components, helpers, lib, theme, types, plus root-level test files) and co-located `lib/slack-socket.test.ts`
- **No `test` script in package.json** — run directly: `pnpm vitest` (watch) or `pnpm vitest run` (CI)
- E2E API tests mock the DB (`@/lib/db`) and file system; import route handlers directly and invoke with `NextRequest`
- Test helpers in `__tests__/helpers/usage-api-mocks.ts` provide factory functions for Anthropic Usage/Cost API mock data

## Conventions
- Use `pnpm` as the package manager
- Dark theme by default (CSS variables in `globals.css`)
- All components use TypeScript with proper typing — no `any`
- Use shadcn/ui components where possible
- Server components by default; `"use client"` only when needed
- Polling-based refresh (configurable interval) rather than WebSockets

## File Ownership (for agent teams)
- **architect**: prisma/, types/, lib/db.ts, project scaffold
- **frontend-dashboard**: app/(dashboard)/page.tsx, components/dashboard/, components/layout/
- **frontend-pages**: app/(dashboard)/agent-teams/, analytics/, chatbot/, knowledge-base/, queue/, roles/, self-healing/, settings/, stuck/, components/chat/, components/chatbot/, components/queue/
- **backend**: app/api/, lib/, server/
- **reviewer**: read-only across all files

## Build & Quality Gates
- **After scaffold**: `pnpm install` and `npx prisma generate` succeed
- **After implementation**: `pnpm build` exits with zero errors
- **After integration**: `pnpm build` + all pages render without runtime errors
- **CRITICAL — No concurrent Next.js processes**: Never run `pnpm dev`, `pnpm build`, or `next dev`/`next build` if a dev server is already running. Turbopack's LSM storage assumes exclusive access to `.next/` — concurrent processes corrupt the cache (SST files), causing all API routes to return 500. If you need to verify the build, first check `pgrep -f 'next dev'` or `fuser 31777/tcp` and skip the build if the dev server is already running. The running dev server already validates compilation.

## Error Recovery
- Build failures: read the error, fix the root cause, rebuild — do not skip or suppress
- Dependency issues: check version compatibility, pin versions if needed
- Type errors: fix the type properly, never use `as any` or `@ts-ignore`
- File conflicts: team lead reads both versions and produces a merged result
- Note: `next.config.ts` has `ignoreBuildErrors: true` for OOM prevention — do not rely on this

## Git Discipline
- Commit after each completed phase with a descriptive message
- Never commit broken code — `pnpm build` must pass before committing
- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`

## Known Limitations
- No WebSocket support — all real-time updates use polling (3-30s intervals)
- Proxy token extraction only works for Anthropic API format (not OpenAI-compatible)
- `ignoreBuildErrors: true` in next.config.ts masks type errors at build time
- Admin API usage sync requires an `sk-ant-admin...` key (not a standard API key)
- Claude Code Analytics API (`/api/usage/claude-code`) requires the organization to have active Claude Code users
- Knowledge Base entries are DB-only (filesystem auto-population was removed — only manually added entries)
- Queue worker must be run separately (`pnpm queue` foreground or `pnpm queue:daemon` persistent tmux) — not embedded in Next.js
- `lib/proxy-manager.ts` singleton only tracks processes spawned in the current server process lifetime; a previously detached proxy will not be tracked after a server restart (use `/api/proxy/status` port probe to detect it)
- `instrumentation.ts` auto-starts `file-watcher.ts` on server boot (Node.js runtime only) — this is experimental
- Slack integration requires a Slack app with Bot Token, and optionally App Token for Socket Mode
- Self-healing auto-repair is best-effort — complex multi-file errors may require manual intervention
