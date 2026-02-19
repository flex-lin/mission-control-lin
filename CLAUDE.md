# Mission Control Lin

Local dashboard for managing Claude Code agent teams, tracking token usage, and monitoring API costs. Built with Next.js, Prisma/SQLite, and tmux.

## Tech Stack
- **Framework**: Next.js 16.1.6 (App Router), React 19
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Database**: SQLite via Prisma ORM 7 + better-sqlite3 (fully local)
- **Charts**: Recharts
- **Process Management**: tmux (agent spawning/monitoring)
- **AI**: Anthropic SDK (team planning via `lib/team-planner.ts`)
- **Proxy**: Node HTTP proxy for API request interception
- **MCP**: Model Context Protocol server for agent tool exposure (`server/mcp-server.ts`)
- **Task Queue**: Standalone background worker (`server/queue-worker.ts`) for automated agent execution
- **Testing**: Vitest (unit + integration tests in `__tests__/` and co-located `lib/*.test.ts`)
- **Validation**: Zod

## Quick Start
```bash
pnpm install        # deps + auto-registers MCP server in .claude/settings.json
npx prisma generate
pnpm dev            # Next.js on :3777
pnpm proxy          # API proxy on :8787 (optional, for proxy-based token tracking)
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
│   ├── stuck/page.tsx        # Stuck task detection across all teams
│   └── settings/page.tsx     # Theme, refresh interval, proxy config, admin API key
├── api/
│   ├── teams/                # CRUD, smart-create, spawn, stuck
│   │   └── [name]/           # health, wake, shutdown, sessions, message, background
│   │       └── tasks/        # task CRUD + reorder; [id]/respond for stuck-task actions
│   ├── analytics/            # Daily aggregation, by-model, by-team, by-member, by-task, ingest, usage-summary
│   ├── usage/                # Anthropic Admin API sync: sync, status, summary, by-model, by-workspace, claude-code
│   ├── queue/                # Task queue CRUD + file attachment upload
│   │   ├── status/           # Worker heartbeat + queue depth summary
│   │   ├── worker/           # Start/stop/inspect the mc-queue-worker tmux session
│   │   └── [id]/attachments/ # Per-task attachment list; [filename] for serve/delete
│   ├── skills/               # MCP skill registry
│   ├── dashboard/stats/      # Overview metrics
│   ├── proxy/                # Proxy status (GET /status) and control (POST /control: start|stop)
│   ├── proxy-logs/           # Request logging (GET list with filters, POST insert)
│   ├── settings/             # User preferences (GET/PUT); usage-limits sub-route (GET/PUT)
│   ├── knowledge-base/       # Knowledge base entries (GET list, POST add, [id] CRUD)
│   ├── projects/             # Indexed project management (same DB as knowledge-base)
│   └── activity/             # Activity feed
└── layout.tsx                # Root layout (fonts, theme, toaster)

components/
├── agent-teams/              # Team cards, health panels, dialogs, task forms, background config
├── analytics/                # Charts, tables, ingest button, usage limits card, proxy status banner, repo usage chart, task token table
├── dashboard/                # Stat cards, activity feed, quick actions
├── knowledge-base/           # Project path management, skills section and tab
├── layout/                   # Sidebar, topbar, command palette, breadcrumbs
├── settings/                 # Settings form
├── stuck/                    # Stuck task feed and filter bar
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
├── api-helpers.ts            # ok(), err(), serverError() response wrappers
├── analytics-helpers.ts      # getCutoffDate(), period parsing, UNTRACKED_TEAM_LABEL constant
├── sleep-detector.ts         # System sleep detection for session checkpoints
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
└── monitor-queue.sh          # Monitors queue worker heartbeat and restarts if stale (pnpm queue:monitor)

prisma/
├── schema.prisma             # All DB models (see Database Models section)
└── mission-control.db        # SQLite database (gitignored: no)

__tests__/                    # Vitest test suite
├── api/                      # End-to-end API integration tests (e.g., e2e-proxy-enabled-analytics.test.ts)
├── components/               # Component tests
├── helpers/                  # Test helper utilities
├── lib/                      # Unit tests for lib modules
└── types/                    # Type-level tests
# Note: some lib unit tests are co-located in lib/ (pricing.test.ts, team-planner.test.ts, team-spawner.test.ts, agent-launcher.test.ts, etc.)

docs/
└── usage-api-spec.md         # Anthropic Usage/Cost API integration specification

types/index.ts                # All shared interfaces (Team, Teammate, Analytics, Usage, etc.)
instrumentation.ts            # Next.js server instrumentation — auto-starts file-watcher on server boot
Procfile                      # Process declarations: web (pnpm dev) + worker (pnpm queue)
```

## Database Models (prisma/schema.prisma)
- **ProxyLog** — per-request record: model, tokens (input/output/cacheRead/cacheCreation), team/member, endpoint, latencyMs, statusCode
- **AnalyticsSnapshot** — daily aggregated cost/token totals by model
- **IndexedProject** — registered project paths with name and tags (DB-only; no filesystem auto-population)
- **Preference** — key-value settings store (theme, refreshInterval, admin API key, usage limits)
- **QueuedTask** — task queue entries with goal, projectPath, status, priority, result, and file attachments (JSON)
- **UsageRecord** — billing-accurate token data synced from Anthropic Usage API (per bucket/model/workspace/serviceTier)
- **CostRecord** — billing-accurate cost data synced from Anthropic Cost API (daily, per model/costType/tokenType)
- **ClaudeCodeDailyMetric** — per-user daily productivity metrics from Anthropic Claude Code Analytics API
- **UsageSyncCursor** — tracks incremental sync position for each data source (usage, cost, claude_code)
- **SessionCheckpoint** — captures team state (task statuses, pane content, member liveness) before sleep for auto-resume

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
- `GET /api/analytics/usage-summary` — daily + monthly totals with configured usage limits from Preferences
- `POST /api/analytics/ingest` — bulk-ingest analytics snapshots

### Token Tracking (Proxy-Based)
- Proxy server (`server/proxy.ts`) intercepts Anthropic API requests on port 8787
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
- **Framework**: Vitest with `globals: true`; configured in `vitest.config.ts` with `@` alias pointing to project root
- **Test locations**: `__tests__/` (api, components, helpers, lib, types) and co-located `lib/*.test.ts` files
- Run: `pnpm vitest` (watch) or `pnpm vitest run` (CI)
- E2E API tests mock the DB (`@/lib/db`) and file system; import route handlers directly and invoke with `NextRequest`
- Co-located lib tests: `lib/pricing.test.ts`, `lib/team-planner.test.ts`, `lib/team-spawner.test.ts`, `lib/agent-launcher.test.ts`, `lib/analytics-helpers.test.ts`, etc.

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
- **frontend-pages**: app/(dashboard)/agent-teams/, analytics/, settings/, knowledge-base/, queue/, stuck/
- **backend**: app/api/, lib/, server/
- **reviewer**: read-only across all files

## Build & Quality Gates
- **After scaffold**: `pnpm install` and `npx prisma generate` succeed
- **After implementation**: `pnpm build` exits with zero errors
- **After integration**: `pnpm build` + all pages render without runtime errors

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
- `POST /api/proxy/control` maintains its own child-process handle separate from `lib/proxy-manager.ts`; Settings page (which uses `lib/proxy-manager.ts`) is the canonical toggle to avoid duplicate processes
- `GET /api/settings/usage-limits` and `PUT /api/settings/usage-limits` manage token/cost limits stored as Preferences; not documented in the original settings route comments
- `lib/proxy-manager.ts` singleton only tracks processes spawned in the current server process lifetime; a previously detached proxy will not be tracked after a server restart (use `/api/proxy/status` port probe to detect it)
- `instrumentation.ts` auto-starts `file-watcher.ts` on server boot (Node.js runtime only) — this is experimental
