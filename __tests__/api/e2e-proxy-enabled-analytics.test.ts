import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for the proxy-enabled settings → token capture → analytics flow.
 *
 * Goal: When proxy is enabled in settings, it should capture all traffic to
 * Anthropic and count the tokens in analytics.
 *
 * Covers:
 * 1. Settings: saving and reading proxyConfig (enabled, port, targetUrl)
 * 2. Settings: proxyConfig persists to ~/.claude/settings.json
 * 3. Settings: proxy config is returned in GET /api/settings
 * 4. Proxy token extraction: non-streaming (JSON) responses
 * 5. Proxy token extraction: streaming (SSE) responses
 * 6. Proxy token extraction: team/member attribution via headers
 * 7. Proxy-logs API: GET /api/proxy-logs lists captured logs with filters
 * 8. Proxy-logs API: POST /api/proxy-logs inserts a log entry
 * 9. Analytics: GET /api/analytics aggregates captured proxy logs by day
 * 10. Analytics: GET /api/analytics/by-model groups tokens by model
 * 11. Analytics: GET /api/analytics/by-team groups tokens by team
 * 12. Analytics: GET /api/analytics/by-member groups tokens by member
 * 13. Analytics: GET /api/analytics/usage-summary returns daily/monthly totals
 * 14. Full flow: enable proxy in settings → logs appear → analytics counts them
 */

// ── Mock DB ────────────────────────────────────────────────────────────────────

const mockPreferenceFindMany = vi.fn();
const mockPreferenceUpsert = vi.fn();
const mockPreferenceDeleteMany = vi.fn();
const mockProxyLogFindMany = vi.fn();
const mockProxyLogCreate = vi.fn();
const mockProxyLogCreateMany = vi.fn();
const mockProxyLogCount = vi.fn();
const mockProxyLogAggregate = vi.fn();
const mockProxyLogGroupBy = vi.fn();
const mockProxyLogDeleteMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    preference: {
      findMany: (...args: unknown[]) => mockPreferenceFindMany(...args),
      upsert: (...args: unknown[]) => mockPreferenceUpsert(...args),
      deleteMany: (...args: unknown[]) => mockPreferenceDeleteMany(...args),
    },
    proxyLog: {
      findMany: (...args: unknown[]) => mockProxyLogFindMany(...args),
      create: (...args: unknown[]) => mockProxyLogCreate(...args),
      createMany: (...args: unknown[]) => mockProxyLogCreateMany(...args),
      count: (...args: unknown[]) => mockProxyLogCount(...args),
      aggregate: (...args: unknown[]) => mockProxyLogAggregate(...args),
      groupBy: (...args: unknown[]) => mockProxyLogGroupBy(...args),
      deleteMany: (...args: unknown[]) => mockProxyLogDeleteMany(...args),
    },
  },
}));

vi.mock("@/lib/pricing", () => ({
  computeCost: vi.fn(
    (
      _model: string,
      input: number,
      output: number,
      cacheRead = 0,
      cacheCreation = 0
    ) => {
      // $3/1M input, $15/1M output (Sonnet-like pricing for tests)
      return ((input + cacheRead + cacheCreation) * 3 + output * 15) / 1_000_000;
    }
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:31777"), init);
}

function createSettingsFile(content: Record<string, unknown> = {}): void {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "settings.json"),
    JSON.stringify(content),
    "utf-8"
  );
}

function readSettingsFile(): Record<string, unknown> {
  const settingsPath = path.join(tmpDir, ".claude", "settings.json");
  return JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
}

function makeSseText(opts: {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): string {
  const {
    model = "claude-sonnet-4-6",
    inputTokens = 1000,
    outputTokens = 500,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
  } = opts;

  return [
    "event: message_start",
    `data: {"type":"message_start","message":{"model":"${model}","usage":{"input_tokens":${inputTokens},"cache_read_input_tokens":${cacheReadTokens},"cache_creation_input_tokens":${cacheCreationTokens}}}}`,
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","delta":{"text":"Hello world"}}',
    "",
    "event: message_delta",
    `data: {"type":"message_delta","usage":{"output_tokens":${outputTokens}}}`,
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
  ].join("\n");
}

function makeProxyLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    timestamp: new Date(),
    model: "claude-sonnet-4-6",
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    teamName: null,
    memberName: null,
    endpoint: "/v1/messages",
    latencyMs: 350,
    statusCode: 200,
    ...overrides,
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proxy-e2e-"));
  vi.stubEnv("HOME", tmpDir);
  vi.resetModules();
  vi.clearAllMocks();

  // Default DB mock responses
  mockPreferenceFindMany.mockResolvedValue([]);
  mockPreferenceUpsert.mockResolvedValue({ key: "theme", value: "dark" });
  mockPreferenceDeleteMany.mockResolvedValue({ count: 0 });
  mockProxyLogFindMany.mockResolvedValue([]);
  mockProxyLogCreate.mockResolvedValue(makeProxyLogEntry());
  mockProxyLogCreateMany.mockResolvedValue({ count: 0 });
  mockProxyLogCount.mockResolvedValue(0);
  mockProxyLogAggregate.mockResolvedValue({
    _avg: { latencyMs: null },
    _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    _count: { id: 0 },
  });
  mockProxyLogGroupBy.mockResolvedValue([]);
  mockProxyLogDeleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Settings: saving proxyConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe("Settings: saving proxyConfig via PUT /api/settings", () => {
  it("saves proxyConfig.enabled=true to the settings file", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
      }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ saved: true });

    const saved = readSettingsFile();
    expect(saved.proxyConfig).toMatchObject({
      enabled: true,
      port: 28787,
      targetUrl: "https://api.anthropic.com",
    });
  });

  it("saves proxyConfig.enabled=false to disable the proxy", async () => {
    createSettingsFile({ proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" } });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        proxyConfig: { enabled: false, port: 28787, targetUrl: "https://api.anthropic.com" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const saved = readSettingsFile();
    expect(saved.proxyConfig).toMatchObject({ enabled: false });
  });

  it("saves custom proxy port and targetUrl", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        proxyConfig: { enabled: true, port: 29000, targetUrl: "https://proxy.example.com" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const saved = readSettingsFile();
    expect(saved.proxyConfig).toMatchObject({
      enabled: true,
      port: 29000,
      targetUrl: "https://proxy.example.com",
    });
  });

  it("updates proxyConfig while preserving other settings", async () => {
    createSettingsFile({
      model: "claude-sonnet-4-6",
      env: { MY_VAR: "value" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const saved = readSettingsFile();
    expect(saved.proxyConfig).toBeDefined();
    expect(saved.model).toBe("claude-sonnet-4-6");
    expect((saved.env as Record<string, string>).MY_VAR).toBe("value");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Settings: reading proxyConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe("Settings: reading proxyConfig via GET /api/settings", () => {
  it("returns proxyConfig from settings file when enabled", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.proxyConfig).toMatchObject({
      enabled: true,
      port: 28787,
      targetUrl: "https://api.anthropic.com",
    });
  });

  it("returns proxyConfig.enabled=false when proxy is disabled", async () => {
    createSettingsFile({
      proxyConfig: { enabled: false, port: 28787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.proxyConfig).toMatchObject({ enabled: false });
  });

  it("returns undefined proxyConfig when not configured", async () => {
    createSettingsFile({ model: "claude-sonnet-4-6" });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // proxyConfig should be absent or undefined
    expect(body.data.proxyConfig).toBeUndefined();
  });

  it("returns both proxyConfig and DB-merged theme", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
    });
    mockPreferenceFindMany.mockResolvedValue([{ key: "theme", value: "light" }]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.theme).toBe("light");
    expect(body.data.proxyConfig.enabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Proxy token extraction: non-streaming JSON responses
// ═══════════════════════════════════════════════════════════════════════════════

describe("Proxy token extraction: non-streaming JSON responses", () => {
  it("extracts model and all token types from a standard Anthropic response", async () => {
    const { extractUsage } = await import("@/server/proxy");
    const result = extractUsage({
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 2000,
        output_tokens: 800,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 1000,
      },
    });

    expect(result.model).toBe("claude-opus-4-6");
    expect(result.inputTokens).toBe(2000);
    expect(result.outputTokens).toBe(800);
    expect(result.cacheReadTokens).toBe(5000);
    expect(result.cacheCreationTokens).toBe(1000);
  });

  it("defaults to zeros and 'unknown' model when fields are missing", async () => {
    const { extractUsage } = await import("@/server/proxy");
    const result = extractUsage({});

    expect(result.model).toBe("unknown");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
  });

  it("handles response with only base tokens (no cache)", async () => {
    const { extractUsage } = await import("@/server/proxy");
    const result = extractUsage({
      model: "claude-3-5-sonnet-20241022",
      usage: { input_tokens: 5000, output_tokens: 1500 },
    });

    expect(result.model).toBe("claude-3-5-sonnet-20241022");
    expect(result.inputTokens).toBe(5000);
    expect(result.outputTokens).toBe(1500);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
  });

  it("handles large token counts correctly (no overflow)", async () => {
    const { extractUsage } = await import("@/server/proxy");
    const result = extractUsage({
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 100_000,
        output_tokens: 50_000,
        cache_read_input_tokens: 500_000,
        cache_creation_input_tokens: 200_000,
      },
    });

    expect(result.inputTokens).toBe(100_000);
    expect(result.outputTokens).toBe(50_000);
    expect(result.cacheReadTokens).toBe(500_000);
    expect(result.cacheCreationTokens).toBe(200_000);
  });

  it("detects non-streaming request correctly", async () => {
    const { isStreamingRequest } = await import("@/server/proxy");
    const nonStreamingBody = Buffer.from(
      JSON.stringify({ model: "claude-sonnet-4-6", messages: [], max_tokens: 1024 })
    );
    expect(isStreamingRequest(nonStreamingBody)).toBe(false);
  });

  it("detects streaming request correctly", async () => {
    const { isStreamingRequest } = await import("@/server/proxy");
    const streamingBody = Buffer.from(
      JSON.stringify({ model: "claude-sonnet-4-6", stream: true, messages: [], max_tokens: 1024 })
    );
    expect(isStreamingRequest(streamingBody)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Proxy token extraction: streaming (SSE) responses
// ═══════════════════════════════════════════════════════════════════════════════

describe("Proxy token extraction: streaming SSE responses", () => {
  it("extracts model and token usage from a complete SSE stream", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = makeSseText({
      model: "claude-sonnet-4-6",
      inputTokens: 3000,
      outputTokens: 750,
      cacheReadTokens: 10000,
      cacheCreationTokens: 500,
    });

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-sonnet-4-6");
    expect(result!.inputTokens).toBe(3000);
    expect(result!.outputTokens).toBe(750);
    expect(result!.cacheReadTokens).toBe(10000);
    expect(result!.cacheCreationTokens).toBe(500);
  });

  it("extracts usage from stream with only message_start (no delta)", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = [
      "event: message_start",
      'data: {"type":"message_start","message":{"model":"claude-opus-4-6","usage":{"input_tokens":500,"cache_read_input_tokens":2000}}}',
      "",
    ].join("\n");

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-opus-4-6");
    expect(result!.inputTokens).toBe(500);
    expect(result!.cacheReadTokens).toBe(2000);
    expect(result!.outputTokens).toBe(0);
  });

  it("returns null for SSE stream with no usage events", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = [
      "event: ping",
      'data: {"type":"ping"}',
      "",
      "event: ping",
      'data: {"type":"ping"}',
      "",
    ].join("\n");

    const result = extractUsageFromSSE(sseText);
    expect(result).toBeNull();
  });

  it("handles malformed JSON lines gracefully (skips, continues)", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = [
      "event: message_start",
      "data: {invalid json that should be skipped}",
      "",
      "event: message_start",
      'data: {"type":"message_start","message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":100}}}',
      "",
    ].join("\n");

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-haiku-4-5-20251001");
    expect(result!.inputTokens).toBe(100);
  });

  it("handles [DONE] SSE marker without crashing", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = [
      "event: message_start",
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":200}}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","usage":{"output_tokens":100}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const result = extractUsageFromSSE(sseText);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(200);
    expect(result!.outputTokens).toBe(100);
  });

  it("correctly tracks both input (message_start) and output (message_delta) tokens", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = makeSseText({ model: "claude-opus-4-6", inputTokens: 4000, outputTokens: 2000 });
    const result = extractUsageFromSSE(sseText);

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(4000);
    expect(result!.outputTokens).toBe(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Proxy token extraction: team/member header attribution
// ═══════════════════════════════════════════════════════════════════════════════

describe("Proxy: team and member attribution via request headers", () => {
  it("isStreamingRequest returns false for empty body", async () => {
    const { isStreamingRequest } = await import("@/server/proxy");
    expect(isStreamingRequest(Buffer.alloc(0))).toBe(false);
  });

  it("isStreamingRequest returns false for non-JSON body", async () => {
    const { isStreamingRequest } = await import("@/server/proxy");
    expect(isStreamingRequest(Buffer.from("not-json"))).toBe(false);
  });

  it("extractUsage associates model from response even when team header not available", async () => {
    // The proxy reads team/member from request headers and associates them with the log.
    // Here we test extractUsage in isolation, confirming model is preserved.
    const { extractUsage } = await import("@/server/proxy");
    const result = extractUsage({
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 1500, output_tokens: 600 },
    });
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("extractUsageFromSSE captures correct model from x-claude-team style flows", async () => {
    // Simulates what a proxy call with x-claude-team: my-team header would yield.
    // The team name is applied outside extractUsageFromSSE, but usage comes from SSE.
    const { extractUsageFromSSE } = await import("@/server/proxy");
    const sseText = makeSseText({ model: "claude-opus-4-6", inputTokens: 8000, outputTokens: 3000 });
    const result = extractUsageFromSSE(sseText);

    expect(result).not.toBeNull();
    // Proxy would then store teamName and memberName alongside this usage
    expect(result!.model).toBe("claude-opus-4-6");
    expect(result!.inputTokens).toBe(8000);
    expect(result!.outputTokens).toBe(3000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Proxy-logs API: GET /api/proxy-logs
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/proxy-logs — list captured proxy logs", () => {
  it("returns empty list when no logs captured", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockProxyLogCount.mockResolvedValue(0);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns captured proxy logs with all fields", async () => {
    const log = makeProxyLogEntry({
      id: 42,
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      teamName: "my-team",
      memberName: "architect",
      endpoint: "/v1/messages",
      latencyMs: 450,
      statusCode: 200,
    });
    mockProxyLogFindMany.mockResolvedValue([log]);
    mockProxyLogCount.mockResolvedValue(1);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].model).toBe("claude-sonnet-4-6");
    expect(body.data[0].inputTokens).toBe(1000);
    expect(body.data[0].outputTokens).toBe(500);
    expect(body.data[0].teamName).toBe("my-team");
    expect(body.data[0].memberName).toBe("architect");
    expect(body.data[0].latencyMs).toBe(450);
    expect(body.meta.count).toBe(1);
  });

  it("filters logs by model parameter", async () => {
    const logs = [
      makeProxyLogEntry({ id: 1, model: "claude-opus-4-6" }),
      makeProxyLogEntry({ id: 2, model: "claude-sonnet-4-6" }),
    ];
    mockProxyLogFindMany.mockResolvedValue([logs[0]]);
    mockProxyLogCount.mockResolvedValue(1);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs?model=claude-opus-4-6");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockProxyLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ model: "claude-opus-4-6" }) })
    );
  });

  it("filters logs by team parameter", async () => {
    mockProxyLogFindMany.mockResolvedValue([
      makeProxyLogEntry({ id: 1, teamName: "team-alpha" }),
    ]);
    mockProxyLogCount.mockResolvedValue(1);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs?team=team-alpha");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockProxyLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamName: "team-alpha" }) })
    );
  });

  it("respects limit and offset pagination", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockProxyLogCount.mockResolvedValue(100);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs?limit=10&offset=20");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockProxyLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 })
    );
    expect(body.meta.limit).toBe(10);
    expect(body.meta.offset).toBe(20);
    expect(body.meta.count).toBe(100);
  });

  it("caps limit at 500 (max allowed)", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockProxyLogCount.mockResolvedValue(0);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs?limit=9999");
    await GET(req);

    expect(mockProxyLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
  });

  it("returns logs ordered by timestamp descending (newest first)", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    const logs = [
      makeProxyLogEntry({ id: 2, timestamp: now }),
      makeProxyLogEntry({ id: 1, timestamp: earlier }),
    ];
    mockProxyLogFindMany.mockResolvedValue(logs);
    mockProxyLogCount.mockResolvedValue(2);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs");
    await GET(req);

    expect(mockProxyLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { timestamp: "desc" } })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Proxy-logs API: POST /api/proxy-logs
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/proxy-logs — record a proxy log entry", () => {
  it("creates a log with model and token counts", async () => {
    const created = makeProxyLogEntry({ id: 100, model: "claude-opus-4-6", inputTokens: 2000, outputTokens: 800 });
    mockProxyLogCreate.mockResolvedValue(created);

    vi.resetModules();
    const { POST } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-4-6",
        inputTokens: 2000,
        outputTokens: 800,
        endpoint: "/v1/messages",
        latencyMs: 320,
        statusCode: 200,
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.model).toBe("claude-opus-4-6");
    expect(mockProxyLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          model: "claude-opus-4-6",
          inputTokens: 2000,
          outputTokens: 800,
        }),
      })
    );
  });

  it("creates a log with team and member attribution", async () => {
    const created = makeProxyLogEntry({
      id: 101,
      teamName: "my-team",
      memberName: "frontend-dev",
    });
    mockProxyLogCreate.mockResolvedValue(created);

    vi.resetModules();
    const { POST } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        teamName: "my-team",
        memberName: "frontend-dev",
        inputTokens: 500,
        outputTokens: 200,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockProxyLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamName: "my-team", memberName: "frontend-dev" }),
      })
    );
  });

  it("returns 400 when model field is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs", {
      method: "POST",
      body: JSON.stringify({ inputTokens: 1000, outputTokens: 500 }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/model/i);
  });

  it("defaults teamName and memberName to null when not provided", async () => {
    const created = makeProxyLogEntry({ id: 102, teamName: null, memberName: null });
    mockProxyLogCreate.mockResolvedValue(created);

    vi.resetModules();
    const { POST } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-4-6" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockProxyLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamName: null, memberName: null }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Analytics: GET /api/analytics (daily aggregation from proxy logs)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/analytics — daily aggregated token counts from proxy logs", () => {
  it("returns empty data array and zero totals when no proxy logs exist", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: null },
      _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      _count: { id: 0 },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/route");
    const req = makeReq("http://localhost:31777/api/analytics?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.totalRequests).toBe(0);
    expect(body.meta.totalInputTokens).toBe(0);
    expect(body.meta.totalOutputTokens).toBe(0);
  });

  it("aggregates proxy logs into daily entries with correct token sums", async () => {
    const today = new Date();
    mockProxyLogFindMany.mockResolvedValue([
      {
        timestamp: today,
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 2000,
        cacheCreationTokens: 300,
      },
      {
        timestamp: today,
        model: "claude-opus-4-6",
        inputTokens: 3000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ]);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: 350 },
      _sum: { inputTokens: 4000, outputTokens: 1500, cacheReadTokens: 2000, cacheCreationTokens: 300 },
      _count: { id: 2 },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/route");
    const req = makeReq("http://localhost:31777/api/analytics?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1); // both logs on same day → one entry

    const dayEntry = body.data[0];
    // totalInput = 1000 + 2000 + 300 + 3000 = 6300
    expect(dayEntry.totalInput).toBe(6300);
    // totalOutput = 500 + 1000 = 1500
    expect(dayEntry.totalOutput).toBe(1500);
    expect(dayEntry.cacheReadTokens).toBe(2000);
    expect(dayEntry.cacheCreationTokens).toBe(300);
    expect(dayEntry.estimatedCost).toBeGreaterThan(0);
    expect(dayEntry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Meta totals
    expect(body.meta.totalRequests).toBe(2);
    // totalInputTokens = 4000 + 2000 + 300 = 6300
    expect(body.meta.totalInputTokens).toBe(6300);
    expect(body.meta.totalOutputTokens).toBe(1500);
    expect(body.meta.totalCacheReadTokens).toBe(2000);
    expect(body.meta.totalCacheCreationTokens).toBe(300);
  });

  it("groups logs across multiple days correctly", async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);

    mockProxyLogFindMany.mockResolvedValue([
      { timestamp: yesterday, model: "claude-sonnet-4-6", inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { timestamp: today, model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ]);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: null },
      _sum: { inputTokens: 1500, outputTokens: 600, cacheReadTokens: 0, cacheCreationTokens: 0 },
      _count: { id: 2 },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/route");
    const req = makeReq("http://localhost:31777/api/analytics?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2); // two distinct days
    expect(body.meta.totalRequests).toBe(2);
  });

  it("queries with correct period cutoff (7d default)", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: null },
      _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      _count: { id: 0 },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/route");
    const req = makeReq("http://localhost:31777/api/analytics");
    await GET(req);

    // Both findMany and aggregate should be called with a timestamp gte filter
    expect(mockProxyLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { timestamp: { gte: expect.any(Date) } } })
    );
    expect(mockProxyLogAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { timestamp: { gte: expect.any(Date) } } })
    );
  });

  it("respects period=30d parameter", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: null },
      _sum: {},
      _count: { id: 0 },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/route");
    const req = makeReq("http://localhost:31777/api/analytics?period=30d");
    await GET(req);

    const callArgs = mockProxyLogFindMany.mock.calls[0][0] as { where: { timestamp: { gte: Date } } };
    const cutoff = callArgs.where.timestamp.gte;
    const now = new Date();
    const daysDiff = (now.getTime() - cutoff.getTime()) / 86_400_000;
    expect(daysDiff).toBeGreaterThanOrEqual(28);
    expect(daysDiff).toBeLessThanOrEqual(32);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Analytics: GET /api/analytics/by-model
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/analytics/by-model — proxy log tokens grouped by model", () => {
  it("returns empty list when no logs exist", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-model/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-model");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns token breakdown per model with estimated cost", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 10000, outputTokens: 5000, cacheReadTokens: 2000, cacheCreationTokens: 500 },
        _count: { id: 20 },
        _avg: { latencyMs: 300 },
      },
      {
        model: "claude-opus-4-6",
        _sum: { inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 5 },
        _avg: { latencyMs: 800 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-model/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-model?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);

    const sonnet = body.data.find((d: { model: string }) => d.model === "claude-sonnet-4-6");
    expect(sonnet).toBeDefined();
    // totalInput = 10000 + 2000 + 500 = 12500
    expect(sonnet.totalInput).toBe(12500);
    expect(sonnet.totalOutput).toBe(5000);
    expect(sonnet.cacheReadTokens).toBe(2000);
    expect(sonnet.cacheCreationTokens).toBe(500);
    expect(sonnet.requests).toBe(20);
    expect(sonnet.avgLatencyMs).toBe(300);
    expect(sonnet.estimatedCost).toBeGreaterThan(0);
    // totalTokens = totalInput + totalOutput
    expect(sonnet.totalTokens).toBe(12500 + 5000);

    const opus = body.data.find((d: { model: string }) => d.model === "claude-opus-4-6");
    expect(opus.totalInput).toBe(5000);
    expect(opus.requests).toBe(5);
  });

  it("queries with correct period cutoff", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-model/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-model?period=7d");
    await GET(req);

    expect(mockProxyLogGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["model"],
        where: { timestamp: { gte: expect.any(Date) } },
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Analytics: GET /api/analytics/by-team
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/analytics/by-team — proxy log tokens grouped by team", () => {
  it("returns empty list when no logs exist", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-team/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-team");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("aggregates token counts per team across all models", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        teamName: "team-alpha",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 1000, cacheCreationTokens: 200 },
        _count: { id: 10 },
      },
      {
        teamName: "team-alpha",
        model: "claude-opus-4-6",
        _sum: { inputTokens: 3000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 5 },
      },
      {
        teamName: "team-beta",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 4 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-team/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-team?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2); // two distinct teams

    const alpha = body.data.find((d: { teamName: string }) => d.teamName === "team-alpha");
    expect(alpha).toBeDefined();
    // totalInput = (5000 + 1000 + 200) + (3000) = 9200
    expect(alpha.totalInput).toBe(9200);
    // totalOutput = 2000 + 1000 = 3000
    expect(alpha.totalOutput).toBe(3000);
    expect(alpha.requests).toBe(15); // 10 + 5
    expect(alpha.estimatedCost).toBeGreaterThan(0);

    const beta = body.data.find((d: { teamName: string }) => d.teamName === "team-beta");
    expect(beta.requests).toBe(4);
  });

  it("labels null teamName as 'untracked'", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        teamName: null,
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 3 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-team/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-team");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].teamName).toBe("untracked");
  });

  it("queries DB with group by teamName and model", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-team/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-team");
    await GET(req);

    expect(mockProxyLogGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["teamName", "model"] })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Analytics: GET /api/analytics/by-member
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/analytics/by-member — proxy log tokens grouped by member", () => {
  it("returns empty list when no member logs exist", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-member/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-member");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("aggregates token counts per team member", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        memberName: "architect",
        teamName: "team-alpha",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 8000, outputTokens: 3000, cacheReadTokens: 2000, cacheCreationTokens: 500 },
        _count: { id: 15 },
        _avg: { latencyMs: 400 },
      },
      {
        memberName: "frontend-dev",
        teamName: "team-alpha",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 4000, outputTokens: 1500, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 8 },
        _avg: { latencyMs: 320 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-member/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-member?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);

    const architect = body.data.find((d: { memberName: string }) => d.memberName === "architect");
    expect(architect).toBeDefined();
    // totalInput = 8000 + 2000 + 500 = 10500
    expect(architect.totalInput).toBe(10500);
    expect(architect.totalOutput).toBe(3000);
    expect(architect.requests).toBe(15);
    expect(architect.teamName).toBe("team-alpha");
    expect(architect.avgLatencyMs).toBe(400);
    expect(architect.estimatedCost).toBeGreaterThan(0);
  });

  it("filters by team when team param is provided", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-member/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-member?team=team-alpha");
    await GET(req);

    expect(mockProxyLogGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamName: "team-alpha" }),
      })
    );
  });

  it("only includes logs with non-null memberName", async () => {
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-member/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-member");
    await GET(req);

    expect(mockProxyLogGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ memberName: { not: null } }),
      })
    );
  });

  it("computes average latency across multiple model groupings for same member", async () => {
    // Same member, two models — latency should be correctly averaged
    mockProxyLogGroupBy.mockResolvedValue([
      {
        memberName: "backend-dev",
        teamName: "team-beta",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 4 },
        _avg: { latencyMs: 300 }, // 4 requests × 300ms = 1200ms
      },
      {
        memberName: "backend-dev",
        teamName: "team-beta",
        model: "claude-opus-4-6",
        _sum: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 2 },
        _avg: { latencyMs: 600 }, // 2 requests × 600ms = 1200ms
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-member/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-member");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1); // merged into one member
    const member = body.data[0];
    expect(member.memberName).toBe("backend-dev");
    expect(member.requests).toBe(6); // 4 + 2
    // Weighted average: (4*300 + 2*600) / 6 = (1200 + 1200) / 6 = 400
    expect(member.avgLatencyMs).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Analytics: GET /api/analytics/usage-summary
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/analytics/usage-summary — daily/monthly token totals from proxy logs", () => {
  it("returns zero usage when no proxy logs exist", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockPreferenceFindMany.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/usage-summary/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.daily.tokens).toBe(0);
    expect(body.data.daily.cost).toBe(0);
    expect(body.data.monthly.tokens).toBe(0);
    expect(body.data.monthly.cost).toBe(0);
  });

  it("computes correct token total from proxy-captured logs", async () => {
    mockProxyLogFindMany.mockResolvedValue([
      {
        model: "claude-sonnet-4-6",
        inputTokens: 5000,
        outputTokens: 2000,
        cacheReadTokens: 1000,
        cacheCreationTokens: 500,
      },
    ]);
    mockPreferenceFindMany.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/usage-summary/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // totalTokens = (5000 + 1000 + 500) + 2000 = 8500
    expect(body.data.daily.tokens).toBe(8500);
    expect(body.data.daily.cost).toBeGreaterThan(0);
  });

  it("returns configured usage limits alongside proxy-captured usage", async () => {
    mockProxyLogFindMany.mockResolvedValue([
      {
        model: "claude-sonnet-4-6",
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ]);
    mockPreferenceFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "1000000" },
      { key: "usage_limit_daily_cost", value: "50" },
      { key: "usage_limit_monthly_tokens", value: "10000000" },
      { key: "usage_limit_monthly_cost", value: "500" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/usage-summary/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.daily.tokens).toBe(15000);
    expect(body.data.daily.tokenLimit).toBe(1000000);
    expect(body.data.daily.costLimit).toBe(50);
    expect(body.data.monthly.tokenLimit).toBe(10000000);
    expect(body.data.monthly.costLimit).toBe(500);
  });

  it("queries proxy logs twice: once for daily, once for monthly cutoff", async () => {
    mockProxyLogFindMany.mockResolvedValue([]);
    mockPreferenceFindMany.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/usage-summary/route");
    await GET();

    expect(mockProxyLogFindMany).toHaveBeenCalledTimes(2);
    const [dailyCall, monthlyCall] = mockProxyLogFindMany.mock.calls as Array<[{ where: { timestamp: { gte: Date } } }]>;
    const dailyCutoff = dailyCall[0].where.timestamp.gte;
    const monthlyCutoff = monthlyCall[0].where.timestamp.gte;

    // Monthly cutoff must be earlier than or equal to daily cutoff
    expect(monthlyCutoff.getTime()).toBeLessThanOrEqual(dailyCutoff.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Full Flow: Enable proxy in settings → capture → analytics
// ═══════════════════════════════════════════════════════════════════════════════

describe("Full flow: proxy config enabled → traffic captured → tokens in analytics", () => {
  it("Step 1: enabling proxy via PUT /api/settings persists the config to file", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const saved = readSettingsFile();
    expect(saved.proxyConfig).toMatchObject({ enabled: true, port: 28787 });
  });

  it("Step 2: GET /api/settings confirms proxy is enabled", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.proxyConfig.enabled).toBe(true);
  });

  it("Step 3: proxy extracts tokens from a captured Anthropic JSON response", async () => {
    const { extractUsage } = await import("@/server/proxy");

    const anthropicResponse = {
      id: "msg_abc123",
      type: "message",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 2500,
        output_tokens: 1200,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 0,
      },
    };

    const usage = extractUsage(anthropicResponse);
    expect(usage.model).toBe("claude-sonnet-4-6");
    expect(usage.inputTokens).toBe(2500);
    expect(usage.outputTokens).toBe(1200);
    expect(usage.cacheReadTokens).toBe(8000);
    expect(usage.cacheCreationTokens).toBe(0);
  });

  it("Step 3b: proxy extracts tokens from a captured Anthropic SSE stream", async () => {
    const { extractUsageFromSSE } = await import("@/server/proxy");

    const sseText = makeSseText({
      model: "claude-opus-4-6",
      inputTokens: 5000,
      outputTokens: 2500,
      cacheReadTokens: 15000,
      cacheCreationTokens: 1000,
    });

    const usage = extractUsageFromSSE(sseText);
    expect(usage).not.toBeNull();
    expect(usage!.model).toBe("claude-opus-4-6");
    expect(usage!.inputTokens).toBe(5000);
    expect(usage!.outputTokens).toBe(2500);
    expect(usage!.cacheReadTokens).toBe(15000);
    expect(usage!.cacheCreationTokens).toBe(1000);
  });

  it("Step 4: captured log is stored and appears in GET /api/proxy-logs", async () => {
    const capturedLog = makeProxyLogEntry({
      id: 1,
      model: "claude-sonnet-4-6",
      inputTokens: 2500,
      outputTokens: 1200,
      cacheReadTokens: 8000,
      cacheCreationTokens: 0,
      teamName: "my-team",
      memberName: "backend-dev",
      endpoint: "/v1/messages",
      latencyMs: 520,
      statusCode: 200,
    });
    mockProxyLogFindMany.mockResolvedValue([capturedLog]);
    mockProxyLogCount.mockResolvedValue(1);

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy-logs/route");
    const req = makeReq("http://localhost:31777/api/proxy-logs");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].model).toBe("claude-sonnet-4-6");
    expect(body.data[0].inputTokens).toBe(2500);
    expect(body.data[0].cacheReadTokens).toBe(8000);
    expect(body.data[0].teamName).toBe("my-team");
    expect(body.data[0].memberName).toBe("backend-dev");
  });

  it("Step 5: captured log appears in GET /api/analytics daily aggregation", async () => {
    const today = new Date();
    mockProxyLogFindMany.mockResolvedValue([
      {
        timestamp: today,
        model: "claude-sonnet-4-6",
        inputTokens: 2500,
        outputTokens: 1200,
        cacheReadTokens: 8000,
        cacheCreationTokens: 0,
      },
    ]);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: 520 },
      _sum: { inputTokens: 2500, outputTokens: 1200, cacheReadTokens: 8000, cacheCreationTokens: 0 },
      _count: { id: 1 },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/route");
    const req = makeReq("http://localhost:31777/api/analytics?period=7d");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    // totalInput = 2500 + 8000 + 0 = 10500
    expect(body.data[0].totalInput).toBe(10500);
    expect(body.data[0].totalOutput).toBe(1200);
    expect(body.data[0].estimatedCost).toBeGreaterThan(0);

    expect(body.meta.totalRequests).toBe(1);
    expect(body.meta.totalInputTokens).toBe(10500);
  });

  it("Step 5b: captured log appears in GET /api/analytics/by-model", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 2500, outputTokens: 1200, cacheReadTokens: 8000, cacheCreationTokens: 0 },
        _count: { id: 1 },
        _avg: { latencyMs: 520 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-model/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-model");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].model).toBe("claude-sonnet-4-6");
    expect(body.data[0].totalInput).toBe(10500); // 2500+8000
    expect(body.data[0].totalOutput).toBe(1200);
    expect(body.data[0].requests).toBe(1);
    expect(body.data[0].estimatedCost).toBeGreaterThan(0);
  });

  it("Step 5c: captured log appears in GET /api/analytics/by-team", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        teamName: "my-team",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 2500, outputTokens: 1200, cacheReadTokens: 8000, cacheCreationTokens: 0 },
        _count: { id: 1 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-team/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-team");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].teamName).toBe("my-team");
    expect(body.data[0].totalInput).toBe(10500);
    expect(body.data[0].requests).toBe(1);
  });

  it("Step 5d: captured log appears in GET /api/analytics/by-member", async () => {
    mockProxyLogGroupBy.mockResolvedValue([
      {
        memberName: "backend-dev",
        teamName: "my-team",
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 2500, outputTokens: 1200, cacheReadTokens: 8000, cacheCreationTokens: 0 },
        _count: { id: 1 },
        _avg: { latencyMs: 520 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-member/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-member");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].memberName).toBe("backend-dev");
    expect(body.data[0].teamName).toBe("my-team");
    expect(body.data[0].totalInput).toBe(10500);
    expect(body.data[0].requests).toBe(1);
  });

  it("Step 5e: captured log appears in GET /api/analytics/usage-summary", async () => {
    mockProxyLogFindMany.mockResolvedValue([
      {
        model: "claude-sonnet-4-6",
        inputTokens: 2500,
        outputTokens: 1200,
        cacheReadTokens: 8000,
        cacheCreationTokens: 0,
      },
    ]);
    mockPreferenceFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "1000000" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/usage-summary/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // total tokens = (2500 + 8000 + 0) + 1200 = 11700
    expect(body.data.daily.tokens).toBe(11700);
    expect(body.data.daily.tokenLimit).toBe(1000000);
    expect(body.data.daily.cost).toBeGreaterThan(0);
  });

  it("disabling proxy: proxyConfig.enabled=false written to settings file", async () => {
    // First enable it
    createSettingsFile({
      proxyConfig: { enabled: true, port: 28787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        proxyConfig: { enabled: false, port: 28787, targetUrl: "https://api.anthropic.com" },
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const saved = readSettingsFile();
    expect(saved.proxyConfig).toMatchObject({ enabled: false });
  });

  it("analytics still shows historical data even after proxy is disabled", async () => {
    // Historical proxy logs remain in DB regardless of current proxy enabled state
    mockProxyLogGroupBy.mockResolvedValue([
      {
        model: "claude-sonnet-4-6",
        _sum: { inputTokens: 50000, outputTokens: 20000, cacheReadTokens: 0, cacheCreationTokens: 0 },
        _count: { id: 100 },
        _avg: { latencyMs: 380 },
      },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/analytics/by-model/route");
    const req = makeReq("http://localhost:31777/api/analytics/by-model");
    const res = await GET(req);
    const body = await res.json();

    // Data exists in analytics DB regardless of current proxy config
    expect(res.status).toBe(200);
    expect(body.data[0].requests).toBe(100);
    expect(body.data[0].totalInput).toBe(50000);
  });
});
