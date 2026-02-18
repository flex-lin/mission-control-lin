# Mission Control

A local dashboard for managing Claude Code agent teams, tracking API token usage, and monitoring costs. Runs entirely on your machine — no cloud services required.

![Dashboard](public/screenshots/dashboard.png)

## Features

### Agent Teams
Create, spawn, monitor, and shut down Claude Code agent teams via tmux. AI-assisted "Smart Create" generates team personas and task breakdowns from a goal description. Teams auto-detect completion and auto-archive after a grace period.

![Agent Teams](public/screenshots/agent-teams.png)

### Analytics
Track token usage, costs, and latency across models, teams, and individual agents. Import historical data from Claude Code session logs.

![Analytics](public/screenshots/analytics.png)

### Settings
Configure theme, polling intervals, API proxy, sleep prevention, and indexed project directories.

![Settings](public/screenshots/settings.png)

### Additional Features
- **Task Queue** — Submit tasks with file attachments that get routed to agent teams
- **Stuck Task Detection** — Surface tasks that are blocked or stalled across all teams
- **Knowledge Base** — Register and browse indexed project directories
- **API Proxy** — Transparent HTTP proxy that intercepts Anthropic API requests, extracts token counts from responses (JSON and SSE), and records them to a local SQLite database
- **Command Palette** — Quick keyboard-driven navigation across the app

## Prerequisites

- Node.js 18+
- pnpm
- tmux (for agent team spawning)
- Claude Code CLI (`claude`) installed and authenticated

## Setup

```bash
pnpm install
npx prisma generate
pnpm db:push          # first time only
pnpm dev              # Next.js on :3777
```

Open [http://localhost:3777](http://localhost:3777).

### Optional: API Proxy

The proxy intercepts Anthropic API calls to record token usage per team/member:

```bash
pnpm proxy   # Starts on port 8787
```

Point Claude Code at the proxy by setting `ANTHROPIC_BASE_URL=http://localhost:8787`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server (port 3777) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm proxy` | Start API proxy (port 8787) |
| `pnpm db:push` | Push Prisma schema to SQLite |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm lint` | Run ESLint |

## Architecture

```
Browser ──→ Next.js (port 3777)
               ├── Dashboard pages (React Server Components)
               ├── API routes (team CRUD, analytics, settings)
               └── Reads/writes ~/.claude/ (team configs, tasks)

Claude CLI ──→ Proxy (port 8787) ──→ Anthropic API
               └── Logs tokens to SQLite
```

**Data storage:**
- **SQLite** (`prisma/mission-control.db`) — proxy logs, analytics snapshots, task queue, settings
- **Filesystem** (`~/.claude/teams/`, `~/.claude/tasks/`) — active team configs, task lists
- **Filesystem** (`~/.claude/teams-archive/`, `~/.claude/tasks-archive/`) — archived teams

## Tech Stack

Next.js 16 | React 19 | TypeScript | Tailwind CSS 4 | shadcn/ui | Prisma + SQLite | Recharts | tmux | Anthropic SDK
