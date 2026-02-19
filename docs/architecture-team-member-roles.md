# Architecture: Optional Team Member Configuration on Task Submission

**Feature:** Allow optional configuration of team members when submitting a new task.
- Preset role library (built-in roles a user can pick from)
- Custom role creation (user-defined roles stored in DB)
- Role management interface (`/roles` page)
- Role selector on the queue task submission form

---

## 1. Data Models

### 1a. New Prisma model: `TeamMemberRole`

Add to `prisma/schema.prisma`:

```prisma
/// A reusable role/persona definition for configuring team members at task submission time
model TeamMemberRole {
  id          Int      @id @default(autoincrement())
  name        String   @unique           // kebab-case slug, e.g. "frontend-dev"
  role        String                     // human title, e.g. "Frontend Developer"
  agentType   String   @map("agent_type") // "general-purpose" | "Bash" | "Explore" | "Plan"
  description String                     // what this agent does
  isPreset    Boolean  @default(false) @map("is_preset")  // true = built-in, cannot delete
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("team_member_roles")
}
```

### 1b. Extended `QueuedTask` model

Add one new column to the existing `QueuedTask` model:

```prisma
model QueuedTask {
  // ... existing fields unchanged ...
  teamMemberConfig String @default("[]") @map("team_member_config")
  // JSON array of TeamMemberRoleConfig objects — the user-selected roles for this task
}
```

The queue worker SQL schema bootstrap in `server/queue-worker.ts` also needs this column:
```sql
team_member_config TEXT NOT NULL DEFAULT '[]'
```

---

## 2. TypeScript Types (add to `types/index.ts`)

```typescript
// ── Team Member Role Types ────────────────────────────────────────────────────

export type AgentType = "general-purpose" | "Bash" | "Explore" | "Plan";

/** A saved role definition (DB-backed, preset or user-created) */
export interface TeamMemberRole {
  id: number;
  name: string;           // kebab-case slug
  role: string;           // human title
  agentType: AgentType;
  description: string;
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A role config stored on a QueuedTask — user's selection at submission time */
export interface TeamMemberRoleConfig {
  roleId: number;         // FK to TeamMemberRole.id (for display/tracking)
  name: string;           // copied at submission time (snapshot)
  role: string;
  agentType: AgentType;
  description: string;
}

// Extend existing QueuedTask type:
export interface QueuedTask {
  // ... existing fields unchanged ...
  teamMemberConfig?: TeamMemberRoleConfig[];
}
```

Also extend `TeamPlan` usage: when the queue worker generates a plan, if `teamMemberConfig` is populated it overrides/merges the AI-generated personas.

---

## 3. Preset Roles Seed Data

Seed these on first startup (via a DB migration or a boot-time upsert in the API layer):

| name | role | agentType | description |
|---|---|---|---|
| `architect` | Architect | Plan | Designs system architecture, data models, and technical decisions |
| `frontend-dev` | Frontend Developer | general-purpose | Implements UI components, pages, and client-side logic |
| `backend-dev` | Backend Developer | general-purpose | Implements API routes, business logic, and database layer |
| `tester` | QA Engineer | Bash | Writes and runs integration tests and validates the full stack |
| `devops` | DevOps Engineer | Bash | Manages build pipelines, deployment scripts, and infrastructure |
| `analyst` | Code Analyst | Explore | Analyzes the codebase to identify issues and improvement opportunities |
| `reviewer` | Code Reviewer | Explore | Reviews code for quality, accessibility, and consistency |
| `tech-writer` | Technical Writer | general-purpose | Writes documentation, README files, and code comments |
| `security` | Security Engineer | Explore | Audits code for vulnerabilities and implements security best practices |
| `data-engineer` | Data Engineer | general-purpose | Designs and implements data pipelines, schemas, and ETL processes |

All presets have `isPreset: true` (cannot be deleted via API).

---

## 4. API Contracts

### 4a. Roles CRUD — `/api/roles`

**GET `/api/roles`**
- Returns all roles (presets + user-created), sorted: presets first, then custom by `createdAt` asc
- Response: `{ data: TeamMemberRole[] }`

**POST `/api/roles`**
- Body: `{ name: string; role: string; agentType: AgentType; description: string }`
- Validates: `name` must be unique, kebab-case only; `agentType` must be valid enum
- Creates role with `isPreset: false`
- Response: `{ data: TeamMemberRole }`

**PATCH `/api/roles/[id]`**
- Body: partial `{ name?, role?, agentType?, description? }`
- Rejects update of `isPreset` field (immutable)
- Response: `{ data: TeamMemberRole }`

**DELETE `/api/roles/[id]`**
- Blocks deletion of `isPreset: true` roles (returns 400)
- Response: `{ data: { deleted: true } }`

**POST `/api/roles/seed`**
- Seeds the preset roles list idempotently (upsert by name)
- Called at app startup via `instrumentation.ts` or on demand
- Response: `{ data: { seeded: number; skipped: number } }`

### 4b. Queue task creation — `POST /api/queue` (extended)

Extended request body:
```typescript
{
  goal: string;                           // required (unchanged)
  projectPath?: string;                   // optional (unchanged)
  priority?: number;                      // optional (unchanged)
  teamMemberConfig?: TeamMemberRoleConfig[]; // NEW: optional array of selected roles
}
```

Behavior: serialize `teamMemberConfig` as JSON into `team_member_config` column.

### 4c. Queue task response — `GET /api/queue` (extended)

All task responses now include `teamMemberConfig: TeamMemberRoleConfig[]` (deserialized from JSON).

---

## 5. Queue Worker Integration

In `server/queue-worker.ts`, when processing a task that has `team_member_config` set:

1. Deserialize `team_member_config` from the DB row into `TeamMemberRoleConfig[]`
2. Call `generateTeamPlan(goal, projectPath)` as usual to get the base plan
3. **If `teamMemberConfig.length > 0`:** replace `plan.personas` entirely with the user-configured roles (converted to `TeamPersona[]`)
4. Proceed to `spawnTeam(plan, projectPath)` as before

Conversion: `TeamMemberRoleConfig → TeamPersona` is a direct field mapping (same shape):
```typescript
function roleConfigToPersona(r: TeamMemberRoleConfig): TeamPersona {
  return { name: r.name, role: r.role, agentType: r.agentType, description: r.description };
}
```

This means the existing `spawnTeam` function is untouched.

---

## 6. Frontend Pages & Components

### 6a. Role Management Page — `/roles`

- New page: `app/(dashboard)/roles/page.tsx`
- Displays two sections: "Preset Roles" (read-only cards) + "Custom Roles" (editable)
- Create custom role via inline form or dialog
- Edit / delete custom roles
- Add link to sidebar: `components/layout/sidebar.tsx`

### 6b. Role Selector on Queue Submit Form — `app/(dashboard)/queue/page.tsx`

Add a collapsible "Configure Team Members (optional)" section below the project path field:

- Fetches `/api/roles` once when the form mounts
- Displays role cards with checkboxes (multi-select)
- Selected roles shown as chips
- "Clear selection" link
- Help text: "If no roles are selected, the AI will automatically generate the team composition."

### 6c. Role Card Component — `components/roles/role-card.tsx`

- Displays: name, role title, agentType badge, description
- Props: `role: TeamMemberRole`, `selected?: boolean`, `onToggle?: () => void`, `onEdit?: () => void`, `onDelete?: () => void`

### 6d. Create/Edit Role Dialog — `components/roles/role-dialog.tsx`

- Fields: Name (kebab-case), Role Title, Agent Type (select), Description (textarea)
- Validates name format client-side
- Calls POST or PATCH accordingly

---

## 7. Database Migration

New migration file: `prisma/migrations/YYYYMMDDHHMMSS_add_team_member_roles/migration.sql`

```sql
-- CreateTable: team_member_roles
CREATE TABLE "team_member_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_preset" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "team_member_roles_name_key" ON "team_member_roles"("name");

-- AddColumn: queued_tasks.team_member_config
ALTER TABLE "queued_tasks" ADD COLUMN "team_member_config" TEXT NOT NULL DEFAULT '[]';
```

---

## 8. Project Structure Changes

```
app/
└── (dashboard)/
    └── roles/
        └── page.tsx              # NEW: Role management page

app/api/
└── roles/
    ├── route.ts                  # NEW: GET list, POST create
    ├── seed/route.ts             # NEW: POST seed presets
    └── [id]/route.ts             # NEW: PATCH update, DELETE

components/
└── roles/                        # NEW directory
    ├── role-card.tsx             # NEW: Role display/select card
    ├── role-dialog.tsx           # NEW: Create/edit dialog
    └── roles-client.tsx          # NEW: Client component for roles page

lib/
└── role-seeds.ts                 # NEW: Preset role definitions array

prisma/
└── schema.prisma                 # MODIFIED: add TeamMemberRole model + QueuedTask.teamMemberConfig

types/index.ts                    # MODIFIED: add TeamMemberRole, TeamMemberRoleConfig, extend QueuedTask

server/queue-worker.ts            # MODIFIED: merge teamMemberConfig into plan personas
app/api/queue/route.ts            # MODIFIED: accept + store teamMemberConfig
app/(dashboard)/queue/page.tsx    # MODIFIED: add role selector section
components/layout/sidebar.tsx     # MODIFIED: add Roles nav link
```

---

## 9. File Ownership Assignment

| File/Area | Owner |
|---|---|
| `prisma/schema.prisma` | backend-dev |
| `lib/role-seeds.ts` | backend-dev |
| `app/api/roles/**` | backend-dev |
| `app/api/queue/route.ts` (extended) | backend-dev |
| `server/queue-worker.ts` (extended) | backend-dev |
| `types/index.ts` (new types) | backend-dev |
| `app/(dashboard)/roles/page.tsx` | frontend-dev |
| `components/roles/**` | frontend-dev |
| `app/(dashboard)/queue/page.tsx` (role selector) | frontend-dev |
| `components/layout/sidebar.tsx` (nav link) | frontend-dev |
| `__tests__/api/roles.test.ts` | tester |
| `__tests__/api/queue-with-roles.test.ts` | tester |
| `__tests__/lib/queue-worker-roles.test.ts` | tester |

---

## 10. Key Constraints & Decisions

1. **Existing spawn path unchanged** — `spawnTeam()` and `launchTeamAsLeader()` are not modified. The queue worker converts `TeamMemberRoleConfig[]` → `TeamPersona[]` before passing to the planner.
2. **Roles are optional** — if user selects no roles, AI planning runs as today. Zero behavioral change for existing tasks.
3. **Snapshot at submission** — `TeamMemberRoleConfig` on the task is a snapshot of the role data at submission time. Changes to the role library after submission do not affect queued tasks.
4. **isPreset immutability** — preset roles cannot be edited or deleted via the API (HTTP 400). They can only be seeded.
5. **agentType validation** — must be one of: `"general-purpose"`, `"Bash"`, `"Explore"`, `"Plan"` (mirrors the existing `TeamPersona.agentType` values used in `team-planner.ts`).
6. **name uniqueness** — role names are globally unique in the DB (unique index). The UI shows an error if the user tries to create a duplicate.
7. **No WebSocket** — role data is fetched once on form mount; the role management page uses standard polling via `useAutoRefresh` if live updates are needed.
