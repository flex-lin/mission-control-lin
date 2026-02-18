# Mission Control Lin

Local dashboard for managing Claude Code agent teams, tracking token usage, and monitoring API costs. Built with Next.js, Prisma/SQLite, and tmux.

## Tech Stack
- **Framework**: Next.js 16 (App Router), React 19
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Database**: SQLite via Prisma ORM + better-sqlite3 (fully local)
- **Charts**: Recharts
- **Process Management**: tmux (agent spawning/monitoring)
- **AI**: Anthropic SDK (team planning)
- **Proxy**: Node HTTP proxy for API request interception

## Quick Start
```bash
pnpm install
npx prisma generate
pnpm dev            # Next.js on :3000
pnpm proxy          # API proxy on :8787 (optional)
```

## Project Structure
```
app/
├── (dashboard)/
│   ├── page.tsx              # Overview — stat cards, activity feed
│   ├── agent-teams/          # Team listing, creation, detail views
│   │   └── [name]/page.tsx   # Individual team (live-updating)
│   ├── analytics/page.tsx    # Token usage, model/team/member breakdowns
│   ├── knowledge-base/       # Placeholder for future KB feature
│   └── settings/page.tsx     # Theme, refresh interval, proxy config
├── api/
│   ├── teams/                # CRUD, smart-create, spawn, health, wake, tasks, sessions
│   ├── analytics/            # Daily aggregation, by-model, by-team, by-member, ingest
│   ├── dashboard/stats/      # Overview metrics
│   ├── proxy/                # Proxy status and control
│   ├── proxy-logs/           # Request logging
│   ├── settings/             # User preferences
│   ├── projects/             # Indexed project management
│   └── activity/             # Activity feed
└── layout.tsx                # Root layout (fonts, theme, toaster)

components/
├── agent-teams/              # Team cards, health panels, dialogs, task forms
├── analytics/                # Charts, tables, ingest button
├── dashboard/                # Stat cards, activity feed, quick actions
├── layout/                   # Sidebar, topbar, command palette, breadcrumbs
├── settings/                 # Settings form
├── theme-provider.tsx        # Dark/light theme (next-themes)
└── ui/                       # shadcn/ui primitives

lib/
├── db.ts                     # Prisma client singleton
├── claude-files.ts           # Read/write ~/.claude/ (teams, tasks, settings)
├── tmux-manager.ts           # tmux session lifecycle
├── agent-launcher.ts         # Build prompts, launch agents in tmux
├── pricing.ts                # MODEL_PRICING table, computeCost()
├── api-helpers.ts            # ok(), err(), serverError() response wrappers
├── analytics-helpers.ts      # getCutoffDate(), period parsing
├── settings-context.tsx      # React context for user settings
├── hooks/use-auto-refresh.ts # Client-side polling hook
└── utils.ts                  # cn() class merge

server/
├── proxy.ts                  # HTTP proxy — intercepts Anthropic API, extracts tokens
├── start-proxy.ts            # Proxy entry point
└── file-watcher.ts           # File change monitoring (experimental)

prisma/
├── schema.prisma             # ProxyLog, AnalyticsSnapshot, IndexedProject, Preference
└── mission-control.db        # SQLite database (gitignored: no)

types/index.ts                # All shared interfaces (Team, Teammate, Analytics, etc.)
```

## Database Models (prisma/schema.prisma)
- **ProxyLog** — per-request record: model, tokens, team/member, latency, status
- **AnalyticsSnapshot** — daily aggregated cost/token totals by model
- **IndexedProject** — registered project paths with tags
- **Preference** — key-value settings store

## Key Architectural Patterns

### Agent Team Lifecycle
1. **Plan**: `POST /api/teams/smart-create` — AI generates team plan (personas + tasks)
2. **Spawn**: `POST /api/teams/spawn` — creates `~/.claude/teams/{name}/` config, launches tmux sessions
3. **Monitor**: `GET /api/teams/[name]/health` — checks tmux process liveness + task staleness
4. **Wake**: `POST /api/teams/[name]/wake` — restarts dead sessions, sends messages
5. **Shutdown**: `GET /api/teams/[name]/shutdown` — kills tmux sessions

### Token Tracking
- Proxy server (`server/proxy.ts`) intercepts Anthropic API requests on port 8787
- Extracts tokens from JSON responses or SSE streams (`message_start`/`message_delta`)
- Records to SQLite via direct better-sqlite3 (not Prisma, for performance)
- Custom headers `x-claude-team` / `x-claude-member` for attribution

### File-Based State (not in DB)
- Team configs: `~/.claude/teams/{name}/config.json`
- Task lists: `~/.claude/tasks/{name}/`
- Managed by `lib/claude-files.ts` with path traversal protection

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
- **frontend-pages**: app/(dashboard)/agent-teams/, analytics/, settings/, knowledge-base/
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
- Knowledge Base and some sidebar nav items are placeholder/unimplemented
