# Anthropic Usage API Integration — Design Specification

## 1. Overview

Integrate the **Anthropic Admin Usage & Cost APIs** into Mission Control to provide real, billing-accurate analytics instead of relying solely on proxy-intercepted or session-log-ingested token counts.

### Data Sources (after integration)

| Source | Accuracy | Granularity | Auth Required |
|--------|----------|-------------|---------------|
| **Usage API** (new) | Billing-accurate | Per-model, per-workspace, per-hour/day | Admin API key (`sk-ant-admin...`) |
| **Cost API** (new) | Billing-accurate (USD) | Per-day, per-workspace | Admin API key |
| **Claude Code Analytics API** (new) | Billing-accurate | Per-user per-day | Admin API key |
| Proxy logs (existing) | Estimated | Per-request | None (local proxy) |
| Session log ingest (existing) | Estimated | Per-request | None (local files) |

---

## 2. Anthropic API Summary

### 2a. Usage API — `GET /v1/organizations/usage_report/messages`

**Auth:** `x-api-key: <ADMIN_API_KEY>`, `anthropic-version: 2023-06-01`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `starting_at` | string (RFC 3339) | Yes | Start time (inclusive, snapped to bucket boundary) |
| `ending_at` | string (RFC 3339) | No | End time (exclusive) |
| `bucket_width` | `"1m"` \| `"1h"` \| `"1d"` | No | Time granularity |
| `group_by[]` | array | No | `api_key_id`, `workspace_id`, `model`, `service_tier`, `context_window`, `inference_geo`, `speed` |
| `models[]` | string[] | No | Filter by model |
| `api_key_ids[]` | string[] | No | Filter by API key |
| `workspace_ids[]` | string[] | No | Filter by workspace |
| `service_tiers[]` | string[] | No | Filter: `standard`, `batch`, `priority`, etc. |
| `limit` | number | No | Max buckets (default/max varies by width) |
| `page` | string | No | Pagination cursor |

**Response shape:**
```ts
{
  data: Array<{
    starting_at: string;  // RFC 3339
    ending_at: string;    // RFC 3339
    results: Array<{
      uncached_input_tokens: number;
      cache_read_input_tokens: number;
      cache_creation: {
        ephemeral_5m_input_tokens: number;
        ephemeral_1h_input_tokens: number;
      };
      output_tokens: number;
      model: string | null;
      api_key_id: string | null;
      workspace_id: string | null;
      service_tier: string | null;
      context_window: string | null;
      inference_geo: string | null;
      speed: string | null;
      server_tool_use: {
        web_search_requests: number;
      };
    }>;
  }>;
  has_more: boolean;
  next_page: string | null;
}
```

### 2b. Cost API — `GET /v1/organizations/cost_report`

**Auth:** Same as above.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `starting_at` | string (RFC 3339) | Yes | Start time |
| `ending_at` | string (RFC 3339) | No | End time |
| `bucket_width` | `"1d"` | No | Daily only |
| `group_by[]` | array | No | `workspace_id`, `description` |
| `limit` | number | No | Max buckets |
| `page` | string | No | Pagination cursor |

**Response shape (when grouped by `description`):**
```ts
{
  data: Array<{
    starting_at: string;
    ending_at: string;
    results: Array<{
      amount: string;        // Cost in cents USD as decimal string, e.g. "123.45" = $1.23
      currency: string;      // "USD"
      cost_type: "tokens" | "web_search" | "code_execution" | null;
      token_type: "uncached_input_tokens" | "output_tokens" | "cache_read_input_tokens"
                | "cache_creation.ephemeral_1h_input_tokens"
                | "cache_creation.ephemeral_5m_input_tokens" | null;
      model: string | null;
      service_tier: string | null;
      workspace_id: string | null;
      context_window: string | null;
      inference_geo: string | null;
      description: string | null;
    }>;
  }>;
  has_more: boolean;
  next_page: string | null;
}
```

### 2c. Claude Code Analytics API — `GET /v1/organizations/usage_report/claude_code`

**Auth:** Same as above.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `starting_at` | string (YYYY-MM-DD) | Yes | Single day (UTC) |
| `limit` | number | No | Records per page (default 20, max 1000) |
| `page` | string | No | Pagination cursor |

**Response shape:**
```ts
{
  data: Array<{
    date: string;  // RFC 3339
    actor: { type: "user_actor"; email_address: string }
         | { type: "api_actor"; api_key_name: string };
    organization_id: string;
    customer_type: "api" | "subscription";
    terminal_type: string;  // "vscode", "tmux", etc.
    core_metrics: {
      num_sessions: number;
      lines_of_code: { added: number; removed: number };
      commits_by_claude_code: number;
      pull_requests_by_claude_code: number;
    };
    tool_actions: {
      edit_tool: { accepted: number; rejected: number };
      multi_edit_tool: { accepted: number; rejected: number };
      write_tool: { accepted: number; rejected: number };
      notebook_edit_tool: { accepted: number; rejected: number };
    };
    model_breakdown: Array<{
      model: string;
      tokens: { input: number; output: number; cache_read: number; cache_creation: number };
      estimated_cost: { currency: string; amount: number };  // cents USD
    }>;
  }>;
  has_more: boolean;
  next_page: string | null;
}
```

---

## 3. New Prisma Models

```prisma
/// Record synced from Anthropic Usage API (per-bucket, per-model)
model UsageRecord {
  id                     Int      @id @default(autoincrement())
  bucketStart            DateTime @map("bucket_start")
  bucketEnd              DateTime @map("bucket_end")
  bucketWidth            String   @map("bucket_width")    // "1m" | "1h" | "1d"
  model                  String?
  workspaceId            String?  @map("workspace_id")
  serviceTier            String?  @map("service_tier")
  uncachedInputTokens    Int      @default(0) @map("uncached_input_tokens")
  cacheReadInputTokens   Int      @default(0) @map("cache_read_input_tokens")
  cache5mCreationTokens  Int      @default(0) @map("cache_5m_creation_tokens")
  cache1hCreationTokens  Int      @default(0) @map("cache_1h_creation_tokens")
  outputTokens           Int      @default(0) @map("output_tokens")
  webSearchRequests      Int      @default(0) @map("web_search_requests")
  syncedAt               DateTime @default(now()) @map("synced_at")

  @@unique([bucketStart, bucketWidth, model, workspaceId, serviceTier], name: "usage_bucket_unique")
  @@index([bucketStart])
  @@index([model])
  @@map("usage_records")
}

/// Record synced from Anthropic Cost API (daily, per-model, per-token-type)
model CostRecord {
  id              Int      @id @default(autoincrement())
  bucketStart     DateTime @map("bucket_start")
  bucketEnd       DateTime @map("bucket_end")
  model           String?
  workspaceId     String?  @map("workspace_id")
  serviceTier     String?  @map("service_tier")
  costType        String?  @map("cost_type")     // "tokens" | "web_search" | "code_execution"
  tokenType       String?  @map("token_type")    // "uncached_input_tokens" | "output_tokens" | etc.
  amountCents     Float    @map("amount_cents")  // cost in cents USD
  currency        String   @default("USD")
  syncedAt        DateTime @default(now()) @map("synced_at")

  @@unique([bucketStart, model, workspaceId, costType, tokenType], name: "cost_bucket_unique")
  @@index([bucketStart])
  @@map("cost_records")
}

/// Claude Code per-user daily analytics from the Admin API
model ClaudeCodeDailyMetric {
  id                       Int      @id @default(autoincrement())
  date                     DateTime
  actorType                String   @map("actor_type")     // "user_actor" | "api_actor"
  actorIdentifier          String   @map("actor_identifier") // email or api_key_name
  terminalType             String?  @map("terminal_type")
  numSessions              Int      @default(0) @map("num_sessions")
  linesAdded               Int      @default(0) @map("lines_added")
  linesRemoved             Int      @default(0) @map("lines_removed")
  commitsByClaudeCode      Int      @default(0) @map("commits_by_claude_code")
  pullRequestsByClaudeCode Int      @default(0) @map("pull_requests_by_claude_code")
  editToolAccepted         Int      @default(0) @map("edit_tool_accepted")
  editToolRejected         Int      @default(0) @map("edit_tool_rejected")
  writeToolAccepted        Int      @default(0) @map("write_tool_accepted")
  writeToolRejected        Int      @default(0) @map("write_tool_rejected")
  notebookEditAccepted     Int      @default(0) @map("notebook_edit_accepted")
  notebookEditRejected     Int      @default(0) @map("notebook_edit_rejected")
  // Model breakdown stored as JSON string: [{model, inputTokens, outputTokens, cacheRead, cacheCreation, costCents}]
  modelBreakdown           String   @default("[]") @map("model_breakdown")
  syncedAt                 DateTime @default(now()) @map("synced_at")

  @@unique([date, actorIdentifier], name: "cc_daily_unique")
  @@index([date])
  @@map("claude_code_daily_metrics")
}

/// Tracks sync state so we know what's already been fetched
model UsageSyncCursor {
  id         String   @id           // "usage" | "cost" | "claude_code"
  lastSyncAt DateTime @map("last_sync_at")  // last bucket end we synced up to
  updatedAt  DateTime @default(now()) @map("updated_at")

  @@map("usage_sync_cursors")
}
```

**Notes:**
- `UsageRecord` uses a composite unique constraint to enable upsert-on-sync (idempotent re-sync).
- `CostRecord.amountCents` stores Anthropic's cents-string as a float for easy aggregation.
- `ClaudeCodeDailyMetric.modelBreakdown` is JSON-stringified since SQLite lacks native JSON columns — keeps the model flat while allowing per-model detail.
- `UsageSyncCursor` tracks incremental sync position per data type.

---

## 4. New API Routes

### 4a. `POST /api/usage/sync` — Trigger sync from Anthropic APIs

Fetches data from the Anthropic Usage, Cost, and/or Claude Code Analytics APIs and upserts into local DB.

**Request body:**
```ts
{
  sources?: ("usage" | "cost" | "claude_code")[];  // default: all three
  startDate?: string;  // ISO date, default: last sync cursor or 7 days ago
  endDate?: string;    // ISO date, default: now
  bucketWidth?: "1m" | "1h" | "1d";  // default: "1d" (for usage)
  groupBy?: string[];  // default: ["model"] (for usage)
}
```

**Response:**
```ts
{
  data: {
    usage: { synced: number; fromDate: string; toDate: string } | null;
    cost: { synced: number; fromDate: string; toDate: string } | null;
    claudeCode: { synced: number; fromDate: string; toDate: string } | null;
  }
}
```

**Implementation notes:**
- Reads Admin API key from `Preference` table (key: `anthropic_admin_api_key`) or env var `ANTHROPIC_ADMIN_API_KEY`.
- Handles pagination (`has_more` / `next_page` loop).
- Upserts records using the unique constraints to avoid duplicates.
- Updates `UsageSyncCursor` after successful sync.
- Returns 400 if no Admin API key is configured.

### 4b. `GET /api/usage/summary` — Aggregated usage summary

Serves the main analytics dashboard with data from `UsageRecord` + `CostRecord`.

**Query params:**
```
?period=7d|30d|1m|all&source=api|proxy|all
```

**Response:**
```ts
{
  data: Array<{
    date: string;
    totalInputTokens: number;     // uncached + cache_read + cache_creation
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    costCents: number;            // from CostRecord (real) or computed (proxy)
    source: "api" | "proxy";
  }>;
  meta: {
    totalCostCents: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests?: number;       // only from proxy data
    period: string;
  }
}
```

### 4c. `GET /api/usage/by-model` — Usage breakdown by model

**Query params:** `?period=7d|30d|1m|all&source=api|proxy|all`

**Response:**
```ts
{
  data: Array<{
    model: string;
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
    source: "api" | "proxy";
  }>
}
```

### 4d. `GET /api/usage/by-workspace` — Usage by Anthropic workspace

**Query params:** `?period=7d|30d|1m|all`

**Response:**
```ts
{
  data: Array<{
    workspaceId: string | null;
    totalInputTokens: number;
    outputTokens: number;
    costCents: number;
  }>
}
```

### 4e. `GET /api/usage/claude-code` — Claude Code productivity metrics

**Query params:** `?period=7d|30d|1m`

**Response:**
```ts
{
  data: {
    summary: {
      totalSessions: number;
      totalLinesAdded: number;
      totalLinesRemoved: number;
      totalCommits: number;
      totalPRs: number;
      avgEditAcceptRate: number;    // 0-1
      avgWriteAcceptRate: number;
    };
    daily: Array<{
      date: string;
      sessions: number;
      linesAdded: number;
      linesRemoved: number;
      commits: number;
      pullRequests: number;
    }>;
    byUser: Array<{
      actor: string;       // email or api_key_name
      sessions: number;
      linesAdded: number;
      linesRemoved: number;
      costCents: number;
    }>;
    byModel: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      costCents: number;
    }>;
  }
}
```

### 4f. `GET /api/usage/status` — Sync status & config check

**Response:**
```ts
{
  data: {
    configured: boolean;         // true if admin API key is set
    lastSync: {
      usage: string | null;      // ISO timestamp
      cost: string | null;
      claudeCode: string | null;
    };
    keyPrefix: string | null;    // first 12 chars of key for verification, e.g. "sk-ant-admin"
  }
}
```

---

## 5. New TypeScript Types (`types/index.ts` additions)

```ts
// ── Usage API Types ──────────────────────────────────────────────────────────

export interface UsageDailySummary {
  date: string;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  costCents: number;
  source: "api" | "proxy";
}

export interface UsageByModel {
  model: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  source: "api" | "proxy";
}

export interface UsageByWorkspace {
  workspaceId: string | null;
  totalInputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface ClaudeCodeSummary {
  summary: {
    totalSessions: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalCommits: number;
    totalPRs: number;
    avgEditAcceptRate: number;
    avgWriteAcceptRate: number;
  };
  daily: Array<{
    date: string;
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    pullRequests: number;
  }>;
  byUser: Array<{
    actor: string;
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    costCents: number;
  }>;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
  }>;
}

export interface UsageSyncResult {
  usage: { synced: number; fromDate: string; toDate: string } | null;
  cost: { synced: number; fromDate: string; toDate: string } | null;
  claudeCode: { synced: number; fromDate: string; toDate: string } | null;
}

export interface UsageSyncStatus {
  configured: boolean;
  lastSync: {
    usage: string | null;
    cost: string | null;
    claudeCode: string | null;
  };
  keyPrefix: string | null;
}
```

---

## 6. New Library Module: `lib/anthropic-usage.ts`

Core client for calling the Anthropic Admin APIs.

```ts
// Key functions:
async function getAdminApiKey(): Promise<string | null>
  // Reads from Preference table (key: "anthropic_admin_api_key")
  // or env var ANTHROPIC_ADMIN_API_KEY

async function fetchUsageReport(params: {
  startingAt: string;
  endingAt?: string;
  bucketWidth?: "1m" | "1h" | "1d";
  groupBy?: string[];
  models?: string[];
}): Promise<UsageBucket[]>
  // Calls GET /v1/organizations/usage_report/messages
  // Handles pagination automatically
  // Returns flattened array of all buckets

async function fetchCostReport(params: {
  startingAt: string;
  endingAt?: string;
  groupBy?: string[];
}): Promise<CostBucket[]>
  // Calls GET /v1/organizations/cost_report
  // Handles pagination automatically

async function fetchClaudeCodeReport(params: {
  startingAt: string;  // YYYY-MM-DD
  limit?: number;
}): Promise<ClaudeCodeRecord[]>
  // Calls GET /v1/organizations/usage_report/claude_code
  // Handles pagination automatically

async function syncUsageData(options: SyncOptions): Promise<UsageSyncResult>
  // Orchestrator: fetches from all APIs, upserts to DB, updates cursors
```

---

## 7. Settings Integration

Add an "API Usage" section to the Settings page (`app/(dashboard)/settings/page.tsx`):

- **Admin API Key** — password input, stored in `Preference` table as `anthropic_admin_api_key`
- **Auto-sync interval** — dropdown: disabled / hourly / every 6h / daily
- **Sync now** button — triggers `POST /api/usage/sync`
- **Status indicator** — shows last sync time and key validity via `GET /api/usage/status`

Store auto-sync preference in `Preference` table (key: `usage_sync_interval`, values: `"disabled"` | `"1h"` | `"6h"` | `"1d"`).

---

## 8. Migration Strategy

### Phase 1: Add new models + sync infrastructure
- Add Prisma models, run migration
- Implement `lib/anthropic-usage.ts` client
- Implement `POST /api/usage/sync` and `GET /api/usage/status`
- Add Admin API key setting to Settings page

### Phase 2: Add new query endpoints
- Implement `/api/usage/summary`, `/api/usage/by-model`, `/api/usage/by-workspace`, `/api/usage/claude-code`
- Each endpoint supports `source=api|proxy|all` to allow comparison

### Phase 3: Update frontend analytics
- Add "Data Source" toggle to analytics pages (API / Proxy / Both)
- Add Claude Code productivity dashboard (new tab or section)
- Show "real cost" (from Cost API) vs "estimated cost" (from proxy) side-by-side

### Phase 4: Keep existing system working
- **No breaking changes** to existing `/api/analytics/*` routes
- Proxy-based tracking continues to work independently
- Session log ingest (`/api/analytics/ingest`) unchanged
- New `/api/usage/*` routes are additive

---

## 9. File Mapping for Implementation

| File | Owner | Purpose |
|------|-------|---------|
| `prisma/schema.prisma` | architect | Add 4 new models |
| `types/index.ts` | architect | Add new type interfaces |
| `lib/anthropic-usage.ts` | backend | Admin API client + sync orchestrator |
| `app/api/usage/sync/route.ts` | backend | Sync trigger endpoint |
| `app/api/usage/status/route.ts` | backend | Sync status endpoint |
| `app/api/usage/summary/route.ts` | backend | Aggregated usage summary |
| `app/api/usage/by-model/route.ts` | backend | Per-model breakdown |
| `app/api/usage/by-workspace/route.ts` | backend | Per-workspace breakdown |
| `app/api/usage/claude-code/route.ts` | backend | Claude Code metrics |
| `components/settings/api-key-section.tsx` | frontend-pages | Admin API key config UI |
| `components/analytics/usage-source-toggle.tsx` | frontend-pages | API vs Proxy toggle |
| `components/analytics/claude-code-dashboard.tsx` | frontend-pages | Productivity metrics UI |
