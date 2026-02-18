import { db } from "@/lib/db";
import type { UsageSyncResult } from "@/types";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

// ── Admin API Key ────────────────────────────────────────────────────────────

export async function getAdminApiKey(): Promise<string | null> {
  // Env var takes precedence
  if (process.env.ANTHROPIC_ADMIN_API_KEY) {
    return process.env.ANTHROPIC_ADMIN_API_KEY;
  }
  const pref = await db.preference.findUnique({
    where: { key: "anthropic_admin_api_key" },
  });
  return pref?.value ?? null;
}

// ── Shared fetch helper ──────────────────────────────────────────────────────

async function adminFetch<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | string[] | undefined>,
): Promise<T> {
  const url = new URL(path, ANTHROPIC_API_BASE);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, v);
    } else {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ── Usage API types (raw Anthropic response) ─────────────────────────────────

interface UsageResult {
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  output_tokens: number;
  model: string | null;
  workspace_id: string | null;
  service_tier: string | null;
  server_tool_use: { web_search_requests: number };
}

interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: UsageResult[];
}

interface UsageResponse {
  data: UsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

// ── Cost API types ──────────────────────────────────────────────────────────

interface CostResult {
  amount: string;
  currency: string;
  cost_type: string | null;
  token_type: string | null;
  model: string | null;
  service_tier: string | null;
  workspace_id: string | null;
}

interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: CostResult[];
}

interface CostResponse {
  data: CostBucket[];
  has_more: boolean;
  next_page: string | null;
}

// ── Claude Code API types ────────────────────────────────────────────────────

interface ClaudeCodeRecord {
  date: string;
  actor:
    | { type: "user_actor"; email_address: string }
    | { type: "api_actor"; api_key_name: string };
  organization_id: string;
  customer_type: string;
  terminal_type: string;
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
    estimated_cost: { currency: string; amount: number };
  }>;
}

interface ClaudeCodeResponse {
  data: ClaudeCodeRecord[];
  has_more: boolean;
  next_page: string | null;
}

// ── Fetchers with pagination ─────────────────────────────────────────────────

export async function fetchUsageReport(
  apiKey: string,
  params: {
    startingAt: string;
    endingAt?: string;
    bucketWidth?: "1m" | "1h" | "1d";
    groupBy?: string[];
    models?: string[];
  },
): Promise<UsageBucket[]> {
  const allBuckets: UsageBucket[] = [];
  let page: string | undefined;

  do {
    const queryParams: Record<string, string | string[] | undefined> = {
      starting_at: params.startingAt,
      ending_at: params.endingAt,
      bucket_width: params.bucketWidth ?? "1d",
      page,
    };
    if (params.groupBy) {
      for (const g of params.groupBy) {
        queryParams[`group_by[]`] = [
          ...((queryParams[`group_by[]`] as string[] | undefined) ?? []),
          g,
        ];
      }
    }
    if (params.models) {
      for (const m of params.models) {
        queryParams[`models[]`] = [
          ...((queryParams[`models[]`] as string[] | undefined) ?? []),
          m,
        ];
      }
    }

    const res = await adminFetch<UsageResponse>(
      apiKey,
      "/v1/organizations/usage_report/messages",
      queryParams,
    );

    allBuckets.push(...res.data);
    page = res.has_more && res.next_page ? res.next_page : undefined;
  } while (page);

  return allBuckets;
}

export async function fetchCostReport(
  apiKey: string,
  params: {
    startingAt: string;
    endingAt?: string;
    groupBy?: string[];
  },
): Promise<CostBucket[]> {
  const allBuckets: CostBucket[] = [];
  let page: string | undefined;

  do {
    const queryParams: Record<string, string | string[] | undefined> = {
      starting_at: params.startingAt,
      ending_at: params.endingAt,
      bucket_width: "1d",
      page,
    };
    if (params.groupBy) {
      for (const g of params.groupBy) {
        queryParams[`group_by[]`] = [
          ...((queryParams[`group_by[]`] as string[] | undefined) ?? []),
          g,
        ];
      }
    }

    const res = await adminFetch<CostResponse>(
      apiKey,
      "/v1/organizations/cost_report",
      queryParams,
    );

    allBuckets.push(...res.data);
    page = res.has_more && res.next_page ? res.next_page : undefined;
  } while (page);

  return allBuckets;
}

export async function fetchClaudeCodeReport(
  apiKey: string,
  params: {
    startingAt: string;
    limit?: number;
  },
): Promise<ClaudeCodeRecord[]> {
  const allRecords: ClaudeCodeRecord[] = [];
  let page: string | undefined;

  do {
    const queryParams: Record<string, string | string[] | undefined> = {
      starting_at: params.startingAt,
      limit: String(params.limit ?? 1000),
      page,
    };

    const res = await adminFetch<ClaudeCodeResponse>(
      apiKey,
      "/v1/organizations/usage_report/claude_code",
      queryParams,
    );

    allRecords.push(...res.data);
    page = res.has_more && res.next_page ? res.next_page : undefined;
  } while (page);

  return allRecords;
}

// ── Sync Orchestrator ────────────────────────────────────────────────────────

export interface SyncOptions {
  sources?: ("usage" | "cost" | "claude_code")[];
  startDate?: string;
  endDate?: string;
  bucketWidth?: "1m" | "1h" | "1d";
  groupBy?: string[];
}

export async function syncUsageData(
  apiKey: string,
  options: SyncOptions = {},
): Promise<UsageSyncResult> {
  const sources = options.sources ?? ["usage", "cost", "claude_code"];
  const endDate = options.endDate ?? new Date().toISOString();
  const result: UsageSyncResult = { usage: null, cost: null, claudeCode: null };

  // Determine start date from cursor or default to 7 days ago
  async function getStartDate(cursorId: string): Promise<string> {
    if (options.startDate) return options.startDate;
    const cursor = await db.usageSyncCursor.findUnique({ where: { id: cursorId } });
    if (cursor) return cursor.lastSyncAt.toISOString();
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }

  // ── Sync Usage ──
  if (sources.includes("usage")) {
    const fromDate = await getStartDate("usage");
    const buckets = await fetchUsageReport(apiKey, {
      startingAt: fromDate,
      endingAt: endDate,
      bucketWidth: options.bucketWidth ?? "1d",
      groupBy: options.groupBy ?? ["model"],
    });

    let synced = 0;
    for (const bucket of buckets) {
      for (const r of bucket.results) {
        await db.usageRecord.upsert({
          where: {
            usage_bucket_unique: {
              bucketStart: new Date(bucket.starting_at),
              bucketWidth: options.bucketWidth ?? "1d",
              model: r.model ?? "",
              workspaceId: r.workspace_id ?? "",
              serviceTier: r.service_tier ?? "",
            },
          },
          update: {
            bucketEnd: new Date(bucket.ending_at),
            uncachedInputTokens: r.uncached_input_tokens,
            cacheReadInputTokens: r.cache_read_input_tokens,
            cache5mCreationTokens: r.cache_creation.ephemeral_5m_input_tokens,
            cache1hCreationTokens: r.cache_creation.ephemeral_1h_input_tokens,
            outputTokens: r.output_tokens,
            webSearchRequests: r.server_tool_use?.web_search_requests ?? 0,
            syncedAt: new Date(),
          },
          create: {
            bucketStart: new Date(bucket.starting_at),
            bucketEnd: new Date(bucket.ending_at),
            bucketWidth: options.bucketWidth ?? "1d",
            model: r.model ?? "",
            workspaceId: r.workspace_id ?? "",
            serviceTier: r.service_tier ?? "",
            uncachedInputTokens: r.uncached_input_tokens,
            cacheReadInputTokens: r.cache_read_input_tokens,
            cache5mCreationTokens: r.cache_creation.ephemeral_5m_input_tokens,
            cache1hCreationTokens: r.cache_creation.ephemeral_1h_input_tokens,
            outputTokens: r.output_tokens,
            webSearchRequests: r.server_tool_use?.web_search_requests ?? 0,
          },
        });
        synced++;
      }
    }

    await db.usageSyncCursor.upsert({
      where: { id: "usage" },
      update: { lastSyncAt: new Date(endDate), updatedAt: new Date() },
      create: { id: "usage", lastSyncAt: new Date(endDate) },
    });

    result.usage = { synced, fromDate, toDate: endDate };
  }

  // ── Sync Cost ──
  if (sources.includes("cost")) {
    const fromDate = await getStartDate("cost");
    const buckets = await fetchCostReport(apiKey, {
      startingAt: fromDate,
      endingAt: endDate,
      groupBy: ["description"],
    });

    let synced = 0;
    for (const bucket of buckets) {
      for (const r of bucket.results) {
        await db.costRecord.upsert({
          where: {
            cost_bucket_unique: {
              bucketStart: new Date(bucket.starting_at),
              model: r.model ?? "",
              workspaceId: r.workspace_id ?? "",
              costType: r.cost_type ?? "",
              tokenType: r.token_type ?? "",
            },
          },
          update: {
            bucketEnd: new Date(bucket.ending_at),
            serviceTier: r.service_tier,
            amountCents: parseFloat(r.amount),
            currency: r.currency,
            syncedAt: new Date(),
          },
          create: {
            bucketStart: new Date(bucket.starting_at),
            bucketEnd: new Date(bucket.ending_at),
            model: r.model ?? "",
            workspaceId: r.workspace_id ?? "",
            serviceTier: r.service_tier,
            costType: r.cost_type ?? "",
            tokenType: r.token_type ?? "",
            amountCents: parseFloat(r.amount),
            currency: r.currency,
          },
        });
        synced++;
      }
    }

    await db.usageSyncCursor.upsert({
      where: { id: "cost" },
      update: { lastSyncAt: new Date(endDate), updatedAt: new Date() },
      create: { id: "cost", lastSyncAt: new Date(endDate) },
    });

    result.cost = { synced, fromDate, toDate: endDate };
  }

  // ── Sync Claude Code ──
  if (sources.includes("claude_code")) {
    const fromDate = await getStartDate("claude_code");
    // Claude Code API takes YYYY-MM-DD, iterate day by day
    const startDay = fromDate.slice(0, 10);
    const endDay = endDate.slice(0, 10);
    let synced = 0;

    const current = new Date(startDay);
    const end = new Date(endDay);

    while (current <= end) {
      const dayStr = current.toISOString().slice(0, 10);
      const records = await fetchClaudeCodeReport(apiKey, { startingAt: dayStr });

      for (const r of records) {
        const actorIdentifier =
          r.actor.type === "user_actor" ? r.actor.email_address : r.actor.api_key_name;

        const modelBreakdown = r.model_breakdown.map((mb) => ({
          model: mb.model,
          inputTokens: mb.tokens.input,
          outputTokens: mb.tokens.output,
          cacheRead: mb.tokens.cache_read,
          cacheCreation: mb.tokens.cache_creation,
          costCents: mb.estimated_cost.amount,
        }));

        const editAccepted = r.tool_actions.edit_tool.accepted + r.tool_actions.multi_edit_tool.accepted;
        const editRejected = r.tool_actions.edit_tool.rejected + r.tool_actions.multi_edit_tool.rejected;

        await db.claudeCodeDailyMetric.upsert({
          where: {
            cc_daily_unique: {
              date: new Date(r.date),
              actorIdentifier,
            },
          },
          update: {
            actorType: r.actor.type,
            terminalType: r.terminal_type,
            numSessions: r.core_metrics.num_sessions,
            linesAdded: r.core_metrics.lines_of_code.added,
            linesRemoved: r.core_metrics.lines_of_code.removed,
            commitsByClaudeCode: r.core_metrics.commits_by_claude_code,
            pullRequestsByClaudeCode: r.core_metrics.pull_requests_by_claude_code,
            editToolAccepted: editAccepted,
            editToolRejected: editRejected,
            writeToolAccepted: r.tool_actions.write_tool.accepted,
            writeToolRejected: r.tool_actions.write_tool.rejected,
            notebookEditAccepted: r.tool_actions.notebook_edit_tool.accepted,
            notebookEditRejected: r.tool_actions.notebook_edit_tool.rejected,
            modelBreakdown: JSON.stringify(modelBreakdown),
            syncedAt: new Date(),
          },
          create: {
            date: new Date(r.date),
            actorType: r.actor.type,
            actorIdentifier,
            terminalType: r.terminal_type,
            numSessions: r.core_metrics.num_sessions,
            linesAdded: r.core_metrics.lines_of_code.added,
            linesRemoved: r.core_metrics.lines_of_code.removed,
            commitsByClaudeCode: r.core_metrics.commits_by_claude_code,
            pullRequestsByClaudeCode: r.core_metrics.pull_requests_by_claude_code,
            editToolAccepted: editAccepted,
            editToolRejected: editRejected,
            writeToolAccepted: r.tool_actions.write_tool.accepted,
            writeToolRejected: r.tool_actions.write_tool.rejected,
            notebookEditAccepted: r.tool_actions.notebook_edit_tool.accepted,
            notebookEditRejected: r.tool_actions.notebook_edit_tool.rejected,
            modelBreakdown: JSON.stringify(modelBreakdown),
          },
        });
        synced++;
      }

      current.setDate(current.getDate() + 1);
    }

    await db.usageSyncCursor.upsert({
      where: { id: "claude_code" },
      update: { lastSyncAt: new Date(endDate), updatedAt: new Date() },
      create: { id: "claude_code", lastSyncAt: new Date(endDate) },
    });

    result.claudeCode = { synced, fromDate: startDay, toDate: endDay };
  }

  return result;
}
