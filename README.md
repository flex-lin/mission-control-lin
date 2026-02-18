# Mission Control Lin

A local dashboard for managing Claude Code agent teams, tracking API token usage, and monitoring costs. Runs entirely on your machine — no cloud services required.

## What It Does

- **Agent Teams** — Create, spawn, monitor, and shut down Claude Code agent teams via tmux. AI-assisted team planning generates personas and task breakdowns from a goal description.
- **Analytics** — Track token usage, costs, and latency across models, teams, and individual agents. Ingest historical data from Claude Code session logs.
- **API Proxy** — Transparent HTTP proxy that intercepts Anthropic API requests, extracts token counts from responses (JSON and SSE), and records them to a local SQLite database.
- **Dashboard** — Overview of active teams, request volume, average latency, and estimated costs with trend comparisons.

## Prerequisites

- Node.js 18+
- pnpm
- tmux (for agent team spawning)
- Claude Code CLI (`claude`) installed and authenticated

## Setup

```bash
# Install dependencies
pnpm install

# Generate Prisma client
npx prisma generate

# Push database schema (first time only)
pnpm db:push

# Start the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional: API Proxy

The proxy intercepts Anthropic API calls to record token usage per team/member:

```bash
pnpm proxy   # Starts on port 8787
```

Point Claude Code at the proxy by setting `ANTHROPIC_BASE_URL=http://localhost:8787`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server (port 3000) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm proxy` | Start API proxy (port 8787) |
| `pnpm db:push` | Push Prisma schema to SQLite |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm lint` | Run ESLint |

## Architecture

```
Browser ──→ Next.js (port 3000)
               ├── Dashboard pages (React Server Components)
               ├── API routes (team CRUD, analytics, settings)
               └── Reads/writes ~/.claude/ (team configs, tasks)

Claude CLI ──→ Proxy (port 8787) ──→ Anthropic API
               └── Logs tokens to SQLite
```

**Data storage:**
- **SQLite** (`prisma/mission-control.db`) — proxy logs, analytics snapshots, settings
- **Filesystem** (`~/.claude/teams/`, `~/.claude/tasks/`) — team configs, task lists

## Tech Stack

Next.js 16 | React 19 | TypeScript | Tailwind CSS 4 | shadcn/ui | Prisma + SQLite | Recharts | tmux | Anthropic SDK
