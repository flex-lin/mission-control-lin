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
- **Validation**: Zod

## Quick Start
```bash
pnpm install        # deps + auto-registers MCP server in .claude/settings.json
npx prisma generate
pnpm dev            # Next.js on :3777
pnpm proxy          # API proxy on :8787 (optional, for proxy-based token tracking)
pnpm queue:daemon   # Queue worker in persistent tmux session (recommended)
# pnpm queue        # Queue worker in foreground (dies on terminal close)
```

### MCP Setup (automatic)
`pnpm install` runs `scripts/setup-mcp.js` (postinstall) which patches
`.claude/settings.json` with the absolute path to `scripts/mcp-server.sh`
for the current machine. Re-run `pnpm mcp:setup` if the project moves.
The MCP server exposes `TeamCreate`, `TeamDelete`, and `SendMessage` to all
Claude Code leader agents spawned by the queue worker.

## Project Structure
```
app/
├── (dashboard)/
│   ├── page.tsx              # Overview — stat cards, activity feed
│   ├── agent-teams/          # Team listing, creation, detail views
│   │   └── [name]/page.tsx   # Individual team (live-updating)
│   ├── analytics/page.tsx    # Token usage, model/team/member breakdowns
│   ├── knowledge-base/       # Registered project directory browser
│   │   └── [id]/page.tsx     # Individual project detail view
│   ├── queue/page.tsx        # Task queue — submit and monitor queued tasks
│   ├── stuck/page.tsx        # Stuck task detection across all teams
│   └── settings/page.tsx     # Theme, refresh interval, proxy config, admin API key
├── api/
│   ├── teams/                # CRUD, smart-create, spawn, stuck
│   │   └── [name]/           # health, wake, shutdown, tasks, sessions, message, background
│   ├── analytics/            # Daily aggregation, by-model, by-team, by-member, ingest
│   ├── usage/                # Anthropic Admin API sync: sync, status, summary, by-model, by-workspace, claude-code
│   ├── queue/                # Task queue CRUD + file attachment upload
│   ├── skills/               # MCP skill registry
│   ├── dashboard/stats/      # Overview metrics
│   ├── proxy/                # Proxy status and control
│   ├── proxy-logs/           # Request logging
│   ├── settings/             # User preferences
│   ├── projects/             # Indexed project management
│   └── activity/             # Activity feed
└── layout.tsx                # Root layout (fonts, theme, toaster)

components/
├── agent-teams/              # Team cards, health panels, dialogs, task forms, background config
├── analytics/                # Charts, tables, ingest button, usage limits card
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
├── api-helpers.ts            # ok(), err(), serverError() response wrappers
├── analytics-helpers.ts      # getCutoffDate(), period parsing
├── sleep-detector.ts         # System sleep detection for session checkpoints
├── settings-context.tsx      # React context for user settings
├── hooks/use-auto-refresh.ts # Client-side polling hook
└── utils.ts                  # cn() class merge

server/
├── proxy.ts                  # HTTP proxy — intercepts Anthropic API, extracts tokens
├── start-proxy.ts            # Proxy entry point
├── mcp-server.ts             # MCP stdio server (TeamCreate/TeamDelete/SendMessage tools)
├── queue-worker.ts           # Background queue processor — AI planning + team spawn + monitoring
├── start-queue-worker.ts     # Queue worker entry point
└── file-watcher.ts           # File change monitoring (experimental)

prisma/
├── schema.prisma             # All DB models (see Database Models section)
└── mission-control.db        # SQLite database (gitignored: no)

types/index.ts                # All shared interfaces (Team, Teammate, Analytics, Usage, etc.)
```

## Database Models (prisma/schema.prisma)
- **ProxyLog** — per-request record: model, tokens, team/member, latency, status
- **AnalyticsSnapshot** — daily aggregated cost/token totals by model
- **IndexedProject** — registered project paths with tags
- **Preference** — key-value settings store
- **QueuedTask** — task queue entries with goal, project path, status, priority, and file attachments
- **UsageRecord** — billing-accurate token data synced from Anthropic Usage API (per bucket/model)
- **CostRecord** — billing-accurate cost data synced from Anthropic Cost API (daily, per model/token-type)
- **ClaudeCodeDailyMetric** — per-user daily productivity metrics from Anthropic Claude Code Analytics API
- **UsageSyncCursor** — tracks incremental sync position for each data source (usage, cost, claude_code)
- **SessionCheckpoint** — captures team state before sleep for auto-resume

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

### Stuck Task Detection
- `GET /api/teams/stuck` — scans all active teams for tasks that have been `in_progress` beyond a threshold
- Stuck page (`app/(dashboard)/stuck/`) surfaces blocked/stalled tasks across all teams with filter controls
- `StuckTask` type extends `TeamTask` with `blockerType`, `blockerSummary`, `blockerDetails`, and `blockerSince` fields

### MCP Server
- `server/mcp-server.ts` exposes `TeamCreate`, `TeamDelete`, and `SendMessage` tools via MCP stdio protocol
- Allows Claude leader agents to manage team directories and send messages without HTTP calls
- Run via `pnpm mcp`; typically configured as a Claude Code MCP server entry

### Background Execution
- `lib/sleep-detector.ts` detects system sleep/wake events for macOS
- `SessionCheckpoint` DB records capture team state (task statuses, pane content, member liveness) before sleep
- `BackgroundConfig` in team config controls: `persistent`, `wakeStrategy` (immediate/scheduled), `wakeDelaySeconds`, `maxWakeRetries`
- Background status surfaced in team health panel via `backgroundExecution` field on `TeamHealth`

### Token Tracking (Proxy-Based)
- Proxy server (`server/proxy.ts`) intercepts Anthropic API requests on port 8787
- Extracts tokens from JSON responses or SSE streams (`message_start`/`message_delta`)
- Records to SQLite via direct better-sqlite3 (not Prisma, for performance)
- Custom headers `x-claude-team` / `x-claude-member` for attribution

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
- Queue worker must be run separately (`pnpm queue`) — it is not embedded in the Next.js process
