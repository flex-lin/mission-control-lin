/**
 * Mock data and helpers for testing the Anthropic Usage API integration.
 *
 * Based on the official Anthropic Usage & Cost Admin API:
 * - GET /v1/organizations/usage_report/messages
 * - GET /v1/organizations/cost_report
 */

// ── Usage Report Mock Data ──────────────────────────────────────────────────

export interface UsageReportResult {
  api_key_id: string | null;
  workspace_id: string | null;
  model: string | null;
  service_tier: string | null;
  context_window: string | null;
  inference_geo: string | null;
  speed: string | null;
  uncached_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  output_tokens: number;
  server_tool_use: {
    web_search_requests: number;
  };
}

export interface UsageReportBucket {
  starting_at: string;
  ending_at: string;
  results: UsageReportResult[];
}

export interface UsageReportResponse {
  data: UsageReportBucket[];
  has_more: boolean;
  next_page: string | null;
}

// ── Cost Report Mock Data ───────────────────────────────────────────────────

export interface CostReportResult {
  workspace_id: string | null;
  description: string | null;
  model: string | null;
  service_tier: string | null;
  context_window: string | null;
  inference_geo: string | null;
  speed: string | null;
  cost_type: string | null;
  token_type: string | null;
  amount: string;
  currency: string;
}

export interface CostReportBucket {
  starting_at: string;
  ending_at: string;
  results: CostReportResult[];
}

export interface CostReportResponse {
  data: CostReportBucket[];
  has_more: boolean;
  next_page: string | null;
}

// ── Factory Functions ───────────────────────────────────────────────────────

export function makeUsageResult(overrides: Partial<UsageReportResult> = {}): UsageReportResult {
  return {
    api_key_id: null,
    workspace_id: null,
    model: "claude-sonnet-4-6",
    service_tier: "standard",
    context_window: "0-200k",
    inference_geo: null,
    speed: null,
    uncached_input_tokens: 50000,
    cache_read_input_tokens: 100000,
    cache_creation: {
      ephemeral_5m_input_tokens: 10000,
      ephemeral_1h_input_tokens: 0,
    },
    output_tokens: 2000,
    server_tool_use: {
      web_search_requests: 0,
    },
    ...overrides,
  };
}

export function makeUsageBucket(
  startDate: string,
  endDate: string,
  results: Partial<UsageReportResult>[] = [{}]
): UsageReportBucket {
  return {
    starting_at: startDate,
    ending_at: endDate,
    results: results.map(makeUsageResult),
  };
}

export function makeUsageResponse(
  buckets: UsageReportBucket[],
  hasMore = false,
  nextPage: string | null = null
): UsageReportResponse {
  return {
    data: buckets,
    has_more: hasMore,
    next_page: nextPage,
  };
}

export function makeCostResult(overrides: Partial<CostReportResult> = {}): CostReportResult {
  return {
    workspace_id: null,
    description: null,
    model: "claude-sonnet-4-6",
    service_tier: "standard",
    context_window: "0-200k",
    inference_geo: null,
    speed: null,
    cost_type: "tokens",
    token_type: "uncached_input_tokens",
    amount: "15.00",
    currency: "USD",
    ...overrides,
  };
}

export function makeCostBucket(
  startDate: string,
  endDate: string,
  results: Partial<CostReportResult>[] = [{}]
): CostReportBucket {
  return {
    starting_at: startDate,
    ending_at: endDate,
    results: results.map(makeCostResult),
  };
}

export function makeCostResponse(
  buckets: CostReportBucket[],
  hasMore = false,
  nextPage: string | null = null
): CostReportResponse {
  return {
    data: buckets,
    has_more: hasMore,
    next_page: nextPage,
  };
}

// ── Realistic Multi-Day Usage Response ──────────────────────────────────────

export function makeWeeklyUsageResponse(): UsageReportResponse {
  const buckets: UsageReportBucket[] = [];
  const baseDate = new Date("2026-02-10T00:00:00Z");

  for (let i = 0; i < 7; i++) {
    const start = new Date(baseDate);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    buckets.push(
      makeUsageBucket(start.toISOString(), end.toISOString(), [
        {
          model: "claude-opus-4-6",
          uncached_input_tokens: 100000 + i * 10000,
          output_tokens: 5000 + i * 500,
          cache_read_input_tokens: 200000,
          cache_creation: { ephemeral_5m_input_tokens: 20000, ephemeral_1h_input_tokens: 0 },
        },
        {
          model: "claude-sonnet-4-6",
          uncached_input_tokens: 50000 + i * 5000,
          output_tokens: 2000 + i * 200,
          cache_read_input_tokens: 80000,
          cache_creation: { ephemeral_5m_input_tokens: 8000, ephemeral_1h_input_tokens: 0 },
        },
      ])
    );
  }

  return makeUsageResponse(buckets);
}

// ── Realistic Multi-Day Cost Response ───────────────────────────────────────

export function makeWeeklyCostResponse(): CostReportResponse {
  const buckets: CostReportBucket[] = [];
  const baseDate = new Date("2026-02-10T00:00:00Z");

  for (let i = 0; i < 7; i++) {
    const start = new Date(baseDate);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    buckets.push(
      makeCostBucket(start.toISOString(), end.toISOString(), [
        {
          model: "claude-opus-4-6",
          cost_type: "tokens",
          token_type: "uncached_input_tokens",
          amount: String((150 + i * 15).toFixed(2)),
        },
        {
          model: "claude-opus-4-6",
          cost_type: "tokens",
          token_type: "output_tokens",
          amount: String((375 + i * 37.5).toFixed(2)),
        },
        {
          model: "claude-sonnet-4-6",
          cost_type: "tokens",
          token_type: "uncached_input_tokens",
          amount: String((15 + i * 1.5).toFixed(2)),
        },
        {
          model: "claude-sonnet-4-6",
          cost_type: "tokens",
          token_type: "output_tokens",
          amount: String((30 + i * 3).toFixed(2)),
        },
      ])
    );
  }

  return makeCostResponse(buckets);
}

// ── Error Responses ─────────────────────────────────────────────────────────

export function makeAnthropicErrorResponse(status: number, message: string) {
  return {
    type: "error",
    error: {
      type: status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : "invalid_request_error",
      message,
    },
  };
}

// ── Paginated Response Helper ───────────────────────────────────────────────

export function makePaginatedUsageResponse(
  page: number,
  totalPages: number,
): UsageReportResponse {
  const start = new Date("2026-02-10T00:00:00Z");
  start.setDate(start.getDate() + page);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return makeUsageResponse(
    [makeUsageBucket(start.toISOString(), end.toISOString())],
    page < totalPages - 1,
    page < totalPages - 1 ? `page_token_${page + 1}` : null,
  );
}
