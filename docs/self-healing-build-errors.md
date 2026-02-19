# Self-Healing Build Error Architecture

## Overview

When a compilation or build error occurs during team execution, the system automatically spawns a dedicated "healer" agent team to diagnose and fix the error, then verifies the build passes before resuming normal flow.

## Problem Statement

The existing leader system prompt already includes a build verification step in its COMPLETION section:
> "Run the project build command (e.g. pnpm build) to verify nothing is broken. If the build fails, fix the issues and rebuild until it passes."

However this relies entirely on the leader agent correctly handling build failures in-context. There is no structured mechanism to:
1. Persist build error state for audit/visibility
2. Automatically spawn a specialist healer team with the full error context
3. Retry the build after healing with a timeout/retry limit
4. Surface build error history in the Mission Control dashboard

## Architecture Design

### 1. New Prisma Data Model

Add to `prisma/schema.prisma`:

```prisma
/// Records a compilation/build error and its healing status
model BuildError {
  id              Int       @id @default(autoincrement())
  teamName        String    @map("team_name")
  projectPath     String    @map("project_path")
  buildCommand    String    @map("build_command")     // e.g. "pnpm build"
  errorOutput     String    @map("error_output")       // full stderr/stdout from failed build
  status          String    @default("open")            // "open" | "healing" | "resolved" | "failed"
  healerTeamName  String?   @map("healer_team_name")   // name of the spawned healer team
  retryCount      Int       @default(0) @map("retry_count")
  maxRetries      Int       @default(3) @map("max_retries")
  resolvedAt      DateTime? @map("resolved_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@index([teamName])
  @@index([status])
  @@map("build_errors")
}
```

### 2. New Library Module: `lib/build-runner.ts`

Responsible for executing build commands and capturing their output.

```typescript
export interface BuildResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;  // stdout + stderr merged
  durationMs: number;
}

/**
 * Run a build command in the given project directory.
 * Returns a BuildResult with the full output regardless of success/failure.
 */
export async function runBuild(
  projectPath: string,
  command: string = "pnpm build"
): Promise<BuildResult>

/**
 * Detect the default build command for a project by inspecting package.json.
 * Falls back to "pnpm build" if not determinable.
 */
export function detectBuildCommand(projectPath: string): string
```

**Implementation notes:**
- Uses Node `child_process.spawn` with `shell: true`
- Captures both stdout and stderr with a combined buffer (max 64 KB truncation)
- Sets a 5-minute timeout per build attempt
- Does NOT throw on non-zero exit — returns structured `BuildResult`

### 3. New Library Module: `lib/build-healer.ts`

Core self-healing orchestration logic.

```typescript
export interface HealAttemptResult {
  buildErrorId: number;
  healerTeamName: string;
  status: "spawned" | "already_healing" | "max_retries_exceeded" | "error";
}

/**
 * Record a build failure and spawn a healer team.
 * Idempotent — if a healer is already running for this team, returns "already_healing".
 */
export async function triggerSelfHealing(
  teamName: string,
  projectPath: string,
  buildCommand: string,
  errorOutput: string
): Promise<HealAttemptResult>

/**
 * Build the system prompt and initial tasks for the healer team.
 * Encodes the full error output so the healer has complete context.
 */
export function buildHealerPlan(
  originalTeamName: string,
  projectPath: string,
  buildCommand: string,
  errorOutput: string
): TeamPlan

/**
 * Called when a healer team finishes. Verifies the build now passes,
 * updates BuildError status, and notifies the original team.
 */
export async function finalizeHealing(
  buildErrorId: number,
  healerTeamName: string
): Promise<{ resolved: boolean; buildResult: BuildResult }>
```

### 4. Healer Team Plan Structure

When `triggerSelfHealing()` is called, it generates a `TeamPlan` with this structure:

```
teamName: "heal-{originalTeam}-{timestamp}"
description: "Fix compilation error in {originalTeam}"

personas:
  - name: "error-analyst"
    role: "Error Analyst"
    agentType: "Explore"
    description: "Reads error output, identifies root cause, locates failing files"

  - name: "fixer"
    role: "Code Fixer"
    agentType: "general-purpose"
    description: "Applies targeted fixes to resolve compilation errors"

initialTasks:
  [1] "Analyze build error"
      owner: error-analyst
      description: |
        The following build error occurred in {projectPath}:
        --- BUILD OUTPUT ---
        {errorOutput (truncated to 8KB)}
        ---
        Identify: (a) which files are causing errors, (b) what type of error (type, import, syntax, etc.),
        (c) what the fix is. Write your findings to ~/.claude/tasks/{healerTeam}/1.json metadata field.

  [2] "Apply fixes"
      owner: fixer
      description: |
        Based on the analysis in task [1], apply the minimal fix to resolve the build error.
        Run {buildCommand} after fixing. If it still fails, repeat the analysis/fix cycle (max 3 tries).
        When the build passes, mark this task completed.
```

The leader system prompt for the healer team adds an additional section:

```
## AFTER HEALING COMPLETES
When all tasks are completed AND the build passes:
1. Call POST /api/build-errors/{buildErrorId}/resolve with {"healerTeamName": "{healerTeamName}"}
2. This notifies the original team and marks the error as resolved
3. Then proceed with normal COMPLETION & CLEANUP protocol
```

### 5. New API Routes

#### `POST /api/build-errors`
Create a new build error record (called internally by the build-healer lib).

Request body:
```json
{
  "teamName": "string",
  "projectPath": "string",
  "buildCommand": "string",
  "errorOutput": "string"
}
```

Response: `{ data: BuildError }`

#### `GET /api/build-errors`
List build errors with optional filters.

Query params: `?team=<name>&status=open|healing|resolved|failed&limit=50`

Response: `{ data: BuildError[], meta: { count } }`

#### `GET /api/build-errors/[id]`
Get a specific build error record.

#### `POST /api/build-errors/[id]/resolve`
Called by the healer team after fixing the build.

Request body:
```json
{
  "healerTeamName": "string"
}
```

Logic:
1. Runs the build command again to verify it passes
2. If passes: sets `status = "resolved"`, `resolvedAt = now()`
3. If fails: increments `retryCount`; if `retryCount < maxRetries`, spawns another healer team; otherwise sets `status = "failed"`
4. Returns `{ data: { resolved: boolean, retryCount: number } }`

#### `DELETE /api/build-errors/[id]`
Dismiss/delete a build error record.

### 6. Integration Points

#### 6a. Leader System Prompt Enhancement (`lib/agent-launcher.ts`)

Modify `writeLeaderLauncher()` to add build error detection to the COMPLETION section:

```
## COMPLETION & CLEANUP
When ALL tasks reach status=completed:
1. Run the project build command (e.g. pnpm build) to verify nothing is broken
2. CAPTURE the full output of the build command
3. If the build PASSES:
   - Stage and commit all changes with a descriptive conventional commit message
   - Send shutdown_request to each teammate via SendMessage
   - After all teammates confirm shutdown, use TeamDelete to clean up
   - Say "All tasks complete. Verified and committed." and stop
4. If the build FAILS:
   - Call POST http://localhost:3777/api/build-errors with the full error output
   - Wait for the response which will include a buildErrorId
   - Say "Build failed. Self-healing triggered (buildErrorId: <id>). Waiting for healer team."
   - Poll GET http://localhost:3777/api/build-errors/<id> every 60 seconds
   - When status becomes "resolved", re-run the build to confirm
   - Then proceed with commit and cleanup
   - If status becomes "failed" (all retries exhausted), report the error and stop
```

#### 6b. Queue Worker Enhancement (`server/queue-worker.ts`)

Add a build verification step to `monitorTeam()` that is triggered when `taskState === "completed"`:

```typescript
// After all tasks complete, verify the build (new step)
if (taskState === "completed") {
  const buildResult = await runBuild(task.project_path);
  if (!buildResult.success) {
    // Trigger self-healing
    const healResult = await triggerSelfHealing(
      teamName, task.project_path, detectBuildCommand(task.project_path), buildResult.combinedOutput
    );
    // Continue monitoring — wait for healer to resolve
    // ... (re-enter monitor loop with extended timeout)
  }
}
```

#### 6c. Dashboard UI (`app/(dashboard)/`)

Add a new page `app/(dashboard)/build-errors/page.tsx`:
- Lists all open/healing/recent build errors
- Shows error output in a code block (collapsible)
- Shows healer team name with link to team detail
- Shows retry count and resolution status
- Color-coded: red (open), yellow (healing), green (resolved), gray (failed)

Add a stat card on the overview dashboard for "Active Build Errors" count.

### 7. Type Definitions (additions to `types/index.ts`)

```typescript
// ── Build Error Types ─────────────────────────────────────────────────────────

export type BuildErrorStatus = "open" | "healing" | "resolved" | "failed";

export interface BuildError {
  id: number;
  teamName: string;
  projectPath: string;
  buildCommand: string;
  errorOutput: string;
  status: BuildErrorStatus;
  healerTeamName?: string | null;
  retryCount: number;
  maxRetries: number;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildErrorCreateInput {
  teamName: string;
  projectPath: string;
  buildCommand: string;
  errorOutput: string;
  maxRetries?: number;
}
```

### 8. File Structure

New files to create:

```
lib/
├── build-runner.ts          # Execute build commands and capture output
├── build-healer.ts          # Self-healing orchestration logic
└── build-runner.test.ts     # Unit tests for build-runner

app/
├── (dashboard)/
│   └── build-errors/
│       └── page.tsx         # Build errors dashboard page
└── api/
    └── build-errors/
        ├── route.ts          # GET list + POST create
        └── [id]/
            ├── route.ts      # GET detail + DELETE dismiss
            └── resolve/
                └── route.ts  # POST resolve (called by healer)

components/
└── build-errors/
    ├── build-error-card.tsx  # Single error card component
    └── build-error-feed.tsx  # List of error cards with filters

__tests__/
└── api/
    └── build-errors.test.ts  # API route tests
```

Modified files:

```
prisma/schema.prisma          # Add BuildError model
types/index.ts                # Add BuildError types
lib/agent-launcher.ts         # Enhance leader system prompt
server/queue-worker.ts        # Add build verification + healing trigger
app/(dashboard)/page.tsx      # Add build errors stat card
components/layout/sidebar.tsx # Add Build Errors nav item
```

### 9. Data Flow Diagram

```
1. Team completes all tasks
         │
         ▼
2. Leader runs build command
         │
    ┌────┴────┐
  PASS       FAIL
    │          │
    ▼          ▼
3. Commit   POST /api/build-errors
& cleanup     │
              ▼
          4. BuildError record created (status=open)
              │
              ▼
          5. triggerSelfHealing() spawns healer team (status=healing)
              │
              ▼
          6. Healer team: error-analyst + fixer work on fixes
              │
              ▼
          7. Healer calls POST /api/build-errors/{id}/resolve
              │
              ▼
          8. Server runs build to verify
              │
         ┌────┴────┐
       PASS       FAIL
         │          │
         ▼          ▼
     status=       retryCount++
     resolved      │
         │    ┌────┴────┐
         ▼  retries    max
     Original  left   reached
     team        │       │
     resumes     ▼       ▼
             Spawn   status=failed
             new     (human
             healer  intervention)
```

### 10. Configuration

Add to `Preference` table (via `/api/settings`):

| Key | Default | Description |
|-----|---------|-------------|
| `build_healing_enabled` | `"true"` | Toggle self-healing on/off |
| `build_healing_max_retries` | `"3"` | Max healer spawns per error |
| `build_healing_timeout_min` | `"30"` | Minutes to wait for healer before declaring failure |

### 11. Error Isolation

The healer team operates in the same `projectPath` as the original team. To prevent conflicts:
- The original team's leader is put into a "waiting" state (polling `/api/build-errors/{id}` for status change)
- The healer team uses a different team name prefix (`heal-`)
- The `BuildError` record serves as the coordination point (atomic status updates via DB)
- If the original leader dies while waiting, the queue worker's existing crash recovery handles re-monitoring

### 12. Testing Strategy

**Unit tests** (`lib/build-runner.test.ts`):
- Mock `child_process.spawn` to simulate pass/fail builds
- Test output truncation at 64 KB
- Test timeout handling
- Test `detectBuildCommand()` with various `package.json` shapes

**API tests** (`__tests__/api/build-errors.test.ts`):
- Mock `@/lib/db` per existing test pattern
- Test CRUD operations
- Test resolve endpoint with both passing and failing mock builds
- Test retry limit enforcement

**Integration**: Covered by existing team lifecycle tests (queue worker tests) — build verification is an extension of the existing completion flow.

### 13. Implementation Phases

**Phase 1 — Foundation** (architect + backend-dev):
- Add `BuildError` model to schema and run migration
- Implement `lib/build-runner.ts` with tests
- Implement `lib/build-healer.ts`
- Add type definitions

**Phase 2 — API layer** (backend-dev):
- `POST /api/build-errors` — create record
- `GET /api/build-errors` and `GET /api/build-errors/[id]`
- `POST /api/build-errors/[id]/resolve`
- `DELETE /api/build-errors/[id]`

**Phase 3 — Integration** (backend-dev):
- Enhance leader system prompt in `lib/agent-launcher.ts`
- Add build verification step to queue worker

**Phase 4 — UI** (frontend-dev):
- Build errors dashboard page
- Stat card on overview
- Sidebar nav entry

**Phase 5 — Tests** (tester):
- Unit tests for build-runner
- API tests for all build-error routes
- Verify `pnpm build` passes with all changes
