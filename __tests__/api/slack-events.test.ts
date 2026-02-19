import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

/**
 * Tests for POST /api/slack/events endpoint
 *
 * Covers:
 * 1. POST with url_verification challenge returns the challenge
 * 2. POST with invalid signature returns 401
 * 3. POST with valid message event is processed
 * 4. POST with bot message is ignored (avoid loops)
 * 5. POST with missing body returns 400
 *
 * Implementation details:
 * - Route calls getSlackConfigRaw() from lib/slack to get signing secret
 * - Route calls verifySlackSignature() inline (real function, not mocked)
 * - url_verification events bypass signature check
 * - Bot messages (bot_id present) and message subtypes are ignored
 * - Route always returns 200 for valid events; message handling is async
 */

// ── DB Mocks ───────────────────────────────────────────────────────────────────
// The events route calls getSlackConfigRaw() which internally uses db.slackConfig

const mockSlackConfigFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    slackConfig: {
      findMany: (...args: unknown[]) => mockSlackConfigFindMany(...args),
    },
  },
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SIGNING_SECRET = "test-signing-secret-abc123";
const TEST_BOT_TOKEN = "xoxb-test-bot-token-123";

function makeFakeDbConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    workspaceId: "T01234567",
    workspaceName: null,
    botToken: TEST_BOT_TOKEN,
    signingSecret: TEST_SIGNING_SECRET,
    appToken: null,
    channelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Signature helpers ─────────────────────────────────────────────────────────

function computeSlackSignature(body: string, timestamp: string, secret: string): string {
  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(sigBase, "utf8");
  return `v0=${hmac.digest("hex")}`;
}

function freshTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

// ── Request builders ──────────────────────────────────────────────────────────

function makeValidSignedReq(body: unknown, secret = TEST_SIGNING_SECRET): NextRequest {
  const bodyStr = JSON.stringify(body);
  const timestamp = freshTimestamp();
  const signature = computeSlackSignature(bodyStr, timestamp, secret);

  return new NextRequest(new URL("http://localhost:3777/api/slack/events"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body: bodyStr,
  });
}

function makeInvalidSignedReq(body: unknown): NextRequest {
  const bodyStr = JSON.stringify(body);
  const timestamp = freshTimestamp();

  return new NextRequest(new URL("http://localhost:3777/api/slack/events"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": "v0=invalidsignaturethatislong000000000000000000000000000000000000",
    },
    body: bodyStr,
  });
}

function makeUnsignedReq(body: unknown): NextRequest {
  const bodyStr = JSON.stringify(body);

  return new NextRequest(new URL("http://localhost:3777/api/slack/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyStr,
  });
}

function makeStaleTimestampReq(body: unknown, secret = TEST_SIGNING_SECRET): NextRequest {
  const bodyStr = JSON.stringify(body);
  // 6 minutes old — beyond the 5 minute replay window
  const staleTimestamp = Math.floor(Date.now() / 1000 - 6 * 60).toString();
  const signature = computeSlackSignature(bodyStr, staleTimestamp, secret);

  return new NextRequest(new URL("http://localhost:3777/api/slack/events"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": staleTimestamp,
      "x-slack-signature": signature,
    },
    body: bodyStr,
  });
}

// ── Route caller ──────────────────────────────────────────────────────────────

async function callPOST(req: NextRequest) {
  vi.resetModules();
  const mod = await import("@/app/api/slack/events/route");
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: config exists
  mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);
});

// ── url_verification ──────────────────────────────────────────────────────────

describe("POST /api/slack/events — url_verification", () => {
  it("returns the challenge value with 200 status", async () => {
    const challengeValue = "my-slack-challenge-token-xyz";

    // url_verification bypasses signature check in the implementation
    const req = makeUnsignedReq({
      type: "url_verification",
      challenge: challengeValue,
      token: "slack-verification-token",
    });

    const { status, body } = await callPOST(req);

    expect(status).toBe(200);
    expect(body.challenge).toBe(challengeValue);
  });

  it("returns challenge even without valid signature (bypassed for url_verification)", async () => {
    const req = makeInvalidSignedReq({
      type: "url_verification",
      challenge: "setup-challenge-abc",
    });

    const { status, body } = await callPOST(req);

    // url_verification is handled before signature check in the implementation
    expect(status).toBe(200);
    expect(body.challenge).toBe("setup-challenge-abc");
  });

  it("does not require Slack config to be set for url_verification", async () => {
    // Config not found — but url_verification should still work
    mockSlackConfigFindMany.mockResolvedValue([]);

    const req = makeUnsignedReq({
      type: "url_verification",
      challenge: "challenge-without-config",
    });

    const { status, body } = await callPOST(req);

    expect(status).toBe(200);
    expect(body.challenge).toBe("challenge-without-config");
  });
});

// ── Slack not configured ──────────────────────────────────────────────────────

describe("POST /api/slack/events — Slack not configured", () => {
  it("returns 503 when no Slack config exists (non-url_verification events)", async () => {
    mockSlackConfigFindMany.mockResolvedValue([]);

    const req = makeValidSignedReq({
      type: "event_callback",
      event: { type: "message", text: "hello", user: "U01234567", channel: "C01234567", ts: "123" },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status } = await callPOST(req);

    expect(status).toBe(503);
  });
});

// ── Signature verification ─────────────────────────────────────────────────────

describe("POST /api/slack/events — signature verification", () => {
  it("returns 401 when signature is invalid", async () => {
    const req = makeInvalidSignedReq({
      type: "event_callback",
      event: { type: "message", text: "hello", user: "U01234567", channel: "C01234567", ts: "123" },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status } = await callPOST(req);

    expect(status).toBe(401);
  });

  it("returns 401 when signature header is missing", async () => {
    const req = makeUnsignedReq({
      type: "event_callback",
      event: { type: "message", text: "hello", user: "U01234567", channel: "C01234567", ts: "123" },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status } = await callPOST(req);

    expect(status).toBe(401);
  });

  it("returns 401 when timestamp is stale (>5 minutes old — replay attack prevention)", async () => {
    const req = makeStaleTimestampReq({
      type: "event_callback",
      event: { type: "message", text: "hello", user: "U01234567", channel: "C01234567", ts: "123" },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status } = await callPOST(req);

    expect(status).toBe(401);
  });

  it("accepts valid HMAC signature and returns 200", async () => {
    const req = makeValidSignedReq({
      type: "event_callback",
      event: { type: "message", text: "hello", user: "U01234567", channel: "C01234567", ts: "123" },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status } = await callPOST(req);

    expect(status).toBe(200);
  });

  it("returns 401 when signed with wrong secret", async () => {
    const req = makeValidSignedReq(
      {
        type: "event_callback",
        event: { type: "message", text: "hello", user: "U01234567", channel: "C01234567", ts: "123" },
        team_id: "T01234567",
        api_app_id: "A01234567",
      },
      "wrong-secret-key" // signed with wrong key
    );

    const { status } = await callPOST(req);

    expect(status).toBe(401);
  });
});

// ── Message events ─────────────────────────────────────────────────────────────

describe("POST /api/slack/events — message event", () => {
  it("returns 200 immediately for a valid user message event", async () => {
    const req = makeValidSignedReq({
      type: "event_callback",
      event: {
        type: "message",
        text: "Hello bot!",
        user: "U01234567",
        channel: "C01234567",
        ts: "1234567890.000001",
      },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status, body } = await callPOST(req);

    expect(status).toBe(200);
    // Route always returns { ok: true } for valid event_callback events
    expect(body.ok).toBe(true);
  });

  it("returns 200 and ignores bot messages (bot_id present) to avoid loops", async () => {
    const req = makeValidSignedReq({
      type: "event_callback",
      event: {
        type: "message",
        text: "I am the bot responding",
        bot_id: "B01234567", // Marks message as from a bot
        user: "U01234567",
        channel: "C01234567",
        ts: "1234567890.000001",
      },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status, body } = await callPOST(req);

    // Bot messages should be silently ignored — still return 200
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("returns 200 and ignores message_changed subtype events", async () => {
    const req = makeValidSignedReq({
      type: "event_callback",
      event: {
        type: "message",
        subtype: "message_changed",
        text: "edited message",
        user: "U01234567",
        channel: "C01234567",
        ts: "1234567890.000001",
      },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status, body } = await callPOST(req);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("returns 200 and ignores message_deleted subtype events", async () => {
    const req = makeValidSignedReq({
      type: "event_callback",
      event: {
        type: "message",
        subtype: "message_deleted",
        user: "U01234567",
        channel: "C01234567",
        ts: "1234567890.000001",
      },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status, body } = await callPOST(req);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("returns 200 for unknown event types (graceful ignore)", async () => {
    const req = makeValidSignedReq({
      type: "event_callback",
      event: {
        type: "reaction_added", // unsupported event type
        user: "U01234567",
        channel: "C01234567",
      },
      team_id: "T01234567",
      api_app_id: "A01234567",
    });

    const { status } = await callPOST(req);

    expect(status).toBe(200);
  });
});

// ── Malformed body ─────────────────────────────────────────────────────────────

describe("POST /api/slack/events — malformed body", () => {
  it("returns 400 for invalid JSON body", async () => {
    const timestamp = freshTimestamp();
    const rawBody = "not-valid-json";
    const signature = computeSlackSignature(rawBody, timestamp, TEST_SIGNING_SECRET);

    const req = new NextRequest(new URL("http://localhost:3777/api/slack/events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body: rawBody,
    });

    const { status } = await callPOST(req);

    expect(status).toBe(400);
  });

  it("returns 400 for empty string body", async () => {
    const timestamp = freshTimestamp();
    const rawBody = "";
    const signature = computeSlackSignature(rawBody, timestamp, TEST_SIGNING_SECRET);

    const req = new NextRequest(new URL("http://localhost:3777/api/slack/events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body: rawBody,
    });

    const { status } = await callPOST(req);

    expect(status).toBe(400);
  });
});
