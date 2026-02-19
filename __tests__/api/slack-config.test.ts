import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for /api/slack/config endpoint
 *
 * Covers:
 * 1. GET returns 404 when no config exists
 * 2. POST creates config with valid data
 * 3. POST validates required fields (botToken, signingSecret, workspaceId)
 * 4. POST rejects invalid data
 * 5. GET returns masked token after config is saved
 * 6. DELETE removes config
 * 7. POST updates existing config (upsert behavior)
 */

// ── DB Mocks ───────────────────────────────────────────────────────────────────
// The config route uses db.slackConfig (a dedicated model, not db.preference)

const mockSlackConfigFindMany = vi.fn();
const mockSlackConfigUpsert = vi.fn();
const mockSlackConfigDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    slackConfig: {
      findMany: (...args: unknown[]) => mockSlackConfigFindMany(...args),
      upsert: (...args: unknown[]) => mockSlackConfigUpsert(...args),
      delete: (...args: unknown[]) => mockSlackConfigDelete(...args),
    },
  },
}));

// ── Route import (top-level, no resetModules to avoid Zod reimport issues) ───

import * as SlackConfigRoute from "@/app/api/slack/config/route";
const { GET, POST, DELETE } = SlackConfigRoute;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePostReq(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:3777/api/slack/config"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validConfig = {
  botToken: "xoxb-test-token-12345",
  signingSecret: "abc123signingsecret",
  workspaceId: "T01234567",
};

function makeFakeDbConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    workspaceId: "T01234567",
    workspaceName: null,
    botToken: "xoxb-test-token-12345",
    signingSecret: "abc123signingsecret",
    channelId: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSlackConfigFindMany.mockResolvedValue([]);
  mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig());
  mockSlackConfigDelete.mockResolvedValue({ id: 1 });
});

// ── GET /api/slack/config ─────────────────────────────────────────────────────

describe("GET /api/slack/config", () => {
  it("returns 404 when no slack config exists", async () => {
    mockSlackConfigFindMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json() as { error: string; code: string };

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it("returns 200 when config exists", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("returns masked botToken — starts with **** and shows last 4 chars", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({
      botToken: "xoxb-test-token-12345",
    })]);

    const res = await GET();
    const body = await res.json() as { data: { botToken: string } };

    expect(res.status).toBe(200);
    const token = body.data.botToken;
    // Should NOT return full token
    expect(token).not.toBe("xoxb-test-token-12345");
    // Should be masked — starts with asterisks, shows last 4 chars
    expect(token).toMatch(/^\*{4}/);
    expect(token).toMatch(/2345$/);
  });

  it("returns masked signingSecret — starts with **** and shows last 4 chars", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({
      signingSecret: "abc123signingsecret",
    })]);

    const res = await GET();
    const body = await res.json() as { data: { signingSecret: string } };

    expect(res.status).toBe(200);
    const secret = body.data.signingSecret;
    // Should NOT return full signing secret
    expect(secret).not.toBe("abc123signingsecret");
    expect(secret).toMatch(/^\*{4}/);
    expect(secret).toMatch(/cret$/);
  });

  it("returns workspaceId in plain text", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);

    const res = await GET();
    const body = await res.json() as { data: { workspaceId: string } };

    expect(res.status).toBe(200);
    expect(body.data.workspaceId).toBe("T01234567");
  });

  it("returns id, createdAt, updatedAt fields", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);

    const res = await GET();
    const body = await res.json() as { data: { id: number; createdAt: string; updatedAt: string } };

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(1);
    expect(typeof body.data.createdAt).toBe("string");
    expect(typeof body.data.updatedAt).toBe("string");
  });

  it("returns channelId when set", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({ channelId: "C01234567" })]);

    const res = await GET();
    const body = await res.json() as { data: { channelId: string | null } };

    expect(res.status).toBe(200);
    expect(body.data.channelId).toBe("C01234567");
  });

  it("returns null channelId when not set", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({ channelId: null })]);

    const res = await GET();
    const body = await res.json() as { data: { channelId: string | null } };

    expect(res.status).toBe(200);
    expect(body.data.channelId).toBeNull();
  });
});

// ── POST /api/slack/config ────────────────────────────────────────────────────

describe("POST /api/slack/config", () => {
  it("creates config with valid data and returns 200", async () => {
    const res = await POST(makePostReq(validConfig));
    const body = await res.json() as { data?: unknown; error?: string };

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.error).toBeUndefined();
  });

  it("calls db.slackConfig.upsert with correct fields", async () => {
    await POST(makePostReq(validConfig));

    expect(mockSlackConfigUpsert).toHaveBeenCalledOnce();
    const arg = mockSlackConfigUpsert.mock.calls[0][0] as {
      where: { workspaceId: string };
      create: { botToken: string; signingSecret: string; workspaceId: string };
      update: { botToken: string; signingSecret: string };
    };
    expect(arg.where.workspaceId).toBe("T01234567");
    expect(arg.create.botToken).toBe("xoxb-test-token-12345");
    expect(arg.create.signingSecret).toBe("abc123signingsecret");
    expect(arg.create.workspaceId).toBe("T01234567");
  });

  it("returns masked botToken in response (last 4 chars of 'xoxb-test-token-12345' is '2345')", async () => {
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({
      botToken: "xoxb-test-token-12345",
    }));

    const res = await POST(makePostReq(validConfig));
    const body = await res.json() as { data: { botToken: string } };

    expect(body.data.botToken).not.toBe("xoxb-test-token-12345");
    expect(body.data.botToken).toMatch(/2345$/);
  });

  it("returns 400 when botToken is missing", async () => {
    const res = await POST(makePostReq({
      signingSecret: "abc123signingsecret",
      workspaceId: "T01234567",
    }));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when signingSecret is missing", async () => {
    const res = await POST(makePostReq({
      botToken: "xoxb-test-token-12345",
      workspaceId: "T01234567",
    }));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when workspaceId is missing", async () => {
    const res = await POST(makePostReq({
      botToken: "xoxb-test-token-12345",
      signingSecret: "abc123signingsecret",
    }));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when botToken does not start with xoxb-", async () => {
    const res = await POST(makePostReq({
      ...validConfig,
      botToken: "not-a-valid-bot-token",
    }));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/xoxb/i);
  });

  it("returns 400 when body is empty object", async () => {
    const res = await POST(makePostReq({}));

    expect(res.status).toBe(400);
  });

  it("returns 400 when botToken is an empty string", async () => {
    const res = await POST(makePostReq({
      ...validConfig,
      botToken: "",
    }));

    expect(res.status).toBe(400);
  });

  it("accepts optional workspaceName field", async () => {
    const res = await POST(makePostReq({
      ...validConfig,
      workspaceName: "My Workspace",
    }));

    expect(res.status).toBe(200);
    const upsertArg = mockSlackConfigUpsert.mock.calls[0][0] as {
      create: { workspaceName: string };
    };
    expect(upsertArg.create.workspaceName).toBe("My Workspace");
  });

  it("accepts optional channelId field", async () => {
    const res = await POST(makePostReq({
      ...validConfig,
      channelId: "C01234567",
    }));

    expect(res.status).toBe(200);
    const upsertArg = mockSlackConfigUpsert.mock.calls[0][0] as {
      create: { channelId: string };
    };
    expect(upsertArg.create.channelId).toBe("C01234567");
  });

  it("updates existing config via upsert (idempotent) — no error on second call", async () => {
    await POST(makePostReq(validConfig));
    const res = await POST(makePostReq({
      ...validConfig,
      botToken: "xoxb-new-token-99999",
    }));

    expect(res.status).toBe(200);
    expect(mockSlackConfigUpsert).toHaveBeenCalledTimes(2);
  });
});

// ── DELETE /api/slack/config ──────────────────────────────────────────────────

describe("DELETE /api/slack/config", () => {
  it("returns 404 when no config exists", async () => {
    mockSlackConfigFindMany.mockResolvedValue([]);

    const res = await DELETE();
    const body = await res.json() as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it("deletes existing config and returns { deleted: true }", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);
    mockSlackConfigDelete.mockResolvedValue({ id: 1 });

    const res = await DELETE();
    const body = await res.json() as { data: { deleted: boolean } };

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it("calls db.slackConfig.delete with the config id", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({ id: 7 })]);

    await DELETE();

    expect(mockSlackConfigDelete).toHaveBeenCalledOnce();
    const deleteArg = mockSlackConfigDelete.mock.calls[0][0] as {
      where: { id: number };
    };
    expect(deleteArg.where.id).toBe(7);
  });
});
