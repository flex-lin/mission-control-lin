# Mission Control Lin

AI/LLM management platform built with Next.js 14.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: SQLite + Prisma ORM (fully local, no external DB)
- **Auth**: NextAuth.js
- **Charts**: Recharts
- **API**: Next.js API routes or tRPC

## Project Structure
```
mission-control-lin/
├── app/
│   ├── (dashboard)/          # Main app pages (layout with sidebar)
│   │   ├── page.tsx          # Overview/Dashboard
│   │   ├── playground/
│   │   ├── knowledge-base/
│   │   ├── fine-tuning/
│   │   ├── analytics/
│   │   ├── team/
│   │   └── settings/
│   ├── api/                  # API routes
│   └── layout.tsx            # Root layout
├── components/
│   ├── layout/               # Sidebar, topbar, user menu
│   ├── dashboard/            # Dashboard-specific components
│   └── ui/                   # shadcn/ui components
├── lib/                      # Utilities, db client, auth config
├── server/                   # Server-side logic, services
├── prisma/                   # Schema and migrations
└── types/                    # Shared TypeScript types
```

## Conventions
- Use `pnpm` as the package manager
- Dark theme by default (dark background, muted foreground colors)
- All components use TypeScript with proper typing — no `any`
- Use shadcn/ui components where possible
- API routes return consistent JSON: `{ data, error, meta }`
- Database queries go through Prisma, never raw SQL
- Use server components by default, `"use client"` only when needed

## File Ownership (for agent teams)
- **architect**: prisma/, types/, lib/db.ts, project scaffold
- **frontend-dashboard**: app/(dashboard)/page.tsx, components/dashboard/, components/layout/
- **frontend-pages**: app/(dashboard)/playground/ through settings/
- **backend**: app/api/, lib/, server/
- **reviewer**: read-only across all files

## Brand
- App name: **Mission Control Lin**
- Sidebar logo text: "Mission Control"
- Dark theme with accent colors for status indicators

## Autonomous Team Rules

### Quality Gates (must pass before moving to next phase)
- **After scaffold**: `pnpm install` and `npx prisma generate` succeed
- **After implementation**: `pnpm build` exits with zero errors
- **After integration**: `pnpm build` + all pages render without runtime errors
- **After review fixes**: `pnpm build` + reviewer confirms all critical issues resolved

### Error Recovery
- Build failures: read the error, fix the root cause, rebuild — do not skip or suppress
- Dependency issues: check version compatibility, pin versions if needed
- Type errors: fix the type properly, never use `as any` or `@ts-ignore`
- File conflicts: team lead reads both versions and produces a merged result

### Git Discipline
- Commit after each completed phase with a descriptive message
- Never commit broken code — `pnpm build` must pass before committing
- Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`

### Self-Improvement
- If a pattern causes repeated issues, update this CLAUDE.md with the fix
- If a new shared type is needed, add it to types/ so all teammates use it
- If a utility is used in 3+ places, extract it to lib/
