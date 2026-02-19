import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for /api/slack/config endpoint
 *
 * Covers:
 * 1. GET returns 404 when no config exists
 * 2. POST creates config with valid data
 * 3. POST validates required fields (botToken, workspaceId)
 * 4. POST rejects invalid data
 * 5. GET returns masked token after config is saved
 * 6. DELETE removes config and stops Socket Mode
 * 7. POST updates existing config (upsert behavior)
 * 8. POST with appToken stores it and auto-starts Socket Mode
 * 9. GET includes socketConnected status
 */

// ── DB Mocks ───────────────────────────────────────────────────────────────────

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

// ── Socket Mode Mocks ────────────────────────────────────────────────────────

const mockStartSocketMode = vi.fn();
const mockStopSocketMode = vi.fn();
const mockIsSocketModeRunning = vi.fn();

vi.mock("@/lib/slack-socket", () => ({
  startSocketMode: (...args: unknown[]) => mockStartSocketMode(...args),
  stopSocketMode: (...args: unknown[]) => mockStopSocketMode(...args),
  isSocketModeRunning: (...args: unknown[]) => mockIsSocketModeRunning(...args),
  getSocketModeClient: vi.fn(() => null),
}));

// ── Route import ─────────────────────────────────────────────────────────────

import * as SlackConfigRoute from "@/app/api/slack/config/route";
const { GET, POST, DELETE } = SlackConfigRoute;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePostReq(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost:31777/api/slack/config"), {
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
    appToken: null,
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
  mockStartSocketMode.mockResolvedValue(undefined);
  mockStopSocketMode.mockResolvedValue(undefined);
  mockIsSocketModeRunning.mockReturnValue(false);
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
    expect(token).not.toBe("xoxb-test-token-12345");
    expect(token).toMatch(/^\*{4}/);
    expect(token).toMatch(/2345$/);
  });

  it("returns masked signingSecret when set", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({
      signingSecret: "abc123signingsecret",
    })]);

    const res = await GET();
    const body = await res.json() as { data: { signingSecret: string } };

    expect(res.status).toBe(200);
    const secret = body.data.signingSecret;
    expect(secret).not.toBe("abc123signingsecret");
    expect(secret).toMatch(/^\*{4}/);
    expect(secret).toMatch(/cret$/);
  });

  it("returns null signingSecret when not set", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig({
      signingSecret: null,
    })]);

    const res = await GET();
    const body = await res.json() as { data: { signingSecret: string | null } };

    expect(res.status).toBe(200);
    expect(body.data.signingSecret).toBeNull();
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

  it("includes socketConnected field from isSocketModeRunning()", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);
    mockIsSocketModeRunning.mockReturnValue(true);

    const res = await GET();
    const body = await res.json() as { data: { socketConnected: boolean } };

    expect(res.status).toBe(200);
    expect(body.data.socketConnected).toBe(true);
  });

  it("socketConnected is false when socket mode is not running", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);
    mockIsSocketModeRunning.mockReturnValue(false);

    const res = await GET();
    const body = await res.json() as { data: { socketConnected: boolean } };

    expect(res.status).toBe(200);
    expect(body.data.socketConnected).toBe(false);
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
      create: { botToken: string; workspaceId: string };
    };
    expect(arg.where.workspaceId).toBe("T01234567");
    expect(arg.create.botToken).toBe("xoxb-test-token-12345");
    expect(arg.create.workspaceId).toBe("T01234567");
  });

  it("returns masked botToken in response", async () => {
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

  it("accepts POST without signingSecret (optional for Socket Mode)", async () => {
    const res = await POST(makePostReq({
      botToken: "xoxb-test-token-12345",
      workspaceId: "T01234567",
    }));

    expect(res.status).toBe(200);
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

  it("updates existing config via upsert (idempotent)", async () => {
    await POST(makePostReq(validConfig));
    const res = await POST(makePostReq({
      ...validConfig,
      botToken: "xoxb-new-token-99999",
    }));

    expect(res.status).toBe(200);
    expect(mockSlackConfigUpsert).toHaveBeenCalledTimes(2);
  });

  // ── appToken / Socket Mode tests ──────────────────────────────────────────

  it("stores appToken when provided", async () => {
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({
      appToken: "xapp-1-test-app-token-xyz",
    }));

    const res = await POST(makePostReq({
      ...validConfig,
      appToken: "xapp-1-test-app-token-xyz",
    }));

    expect(res.status).toBe(200);
    const upsertArg = mockSlackConfigUpsert.mock.calls[0][0] as {
      create: { appToken: string };
    };
    expect(upsertArg.create.appToken).toBe("xapp-1-test-app-token-xyz");
  });

  it("returns masked appToken in response", async () => {
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({
      appToken: "xapp-1-test-app-token-xyz",
    }));

    const res = await POST(makePostReq({
      ...validConfig,
      appToken: "xapp-1-test-app-token-xyz",
    }));
    const body = await res.json() as { data: { appToken: string } };

    expect(body.data.appToken).not.toBe("xapp-1-test-app-token-xyz");
    expect(body.data.appToken).toMatch(/^\*{4}/);
    expect(body.data.appToken).toMatch(/-xyz$/);
  });

  it("returns null appToken when not provided", async () => {
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({ appToken: null }));

    const res = await POST(makePostReq(validConfig));
    const body = await res.json() as { data: { appToken: string | null } };

    expect(body.data.appToken).toBeNull();
  });

  it("returns 400 when appToken does not start with xapp-", async () => {
    const res = await POST(makePostReq({
      ...validConfig,
      appToken: "not-a-valid-app-token",
    }));
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/xapp/i);
  });

  it("auto-starts Socket Mode when appToken is provided", async () => {
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({
      appToken: "xapp-1-test-app-token-xyz",
    }));

    await POST(makePostReq({
      ...validConfig,
      appToken: "xapp-1-test-app-token-xyz",
    }));

    expect(mockStartSocketMode).toHaveBeenCalledOnce();
    expect(mockStartSocketMode).toHaveBeenCalledWith(
      "xapp-1-test-app-token-xyz",
      "xoxb-test-token-12345"
    );
  });

  it("does not start Socket Mode when appToken is not provided", async () => {
    await POST(makePostReq(validConfig));

    expect(mockStartSocketMode).not.toHaveBeenCalled();
  });

  it("stops Socket Mode when appToken is removed", async () => {
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({ appToken: null }));

    await POST(makePostReq(validConfig));

    expect(mockStopSocketMode).toHaveBeenCalledOnce();
  });

  it("includes socketConnected in POST response", async () => {
    mockIsSocketModeRunning.mockReturnValue(true);
    mockSlackConfigUpsert.mockResolvedValue(makeFakeDbConfig({
      appToken: "xapp-1-test-app-token-xyz",
    }));

    const res = await POST(makePostReq({
      ...validConfig,
      appToken: "xapp-1-test-app-token-xyz",
    }));
    const body = await res.json() as { data: { socketConnected: boolean } };

    expect(body.data.socketConnected).toBe(true);
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

  it("stops Socket Mode when config is deleted", async () => {
    mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);

    await DELETE();

    expect(mockStopSocketMode).toHaveBeenCalledOnce();
  });
});
