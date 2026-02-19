/**
 * Slack integration utilities.
 * Provides signature verification, message sending, and config retrieval.
 */
import crypto from "crypto";
import { db } from "@/lib/db";
import type { SlackConfig } from "@/types";

// ── Signature Verification ────────────────────────────────────────────────────

/**
 * Verifies a Slack request signature.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): Promise<boolean> {
  // Reject requests older than 5 minutes to prevent replay attacks
  const requestAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (requestAge > 300) {
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${body}`;
  const expectedSignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBaseString, "utf8")
      .digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch {
    return false;
  }
}

// ── Config Access ─────────────────────────────────────────────────────────────

/**
 * Fetch the Slack config from the DB (raw, with secrets unmasked).
 * Returns null if not configured.
 */
export async function getSlackConfigRaw(): Promise<{
  id: number;
  workspaceId: string;
  workspaceName: string | null;
  botToken: string;
  signingSecret: string;
  channelId: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const configs = await db.slackConfig.findMany({ take: 1 });
  return configs[0] ?? null;
}

/**
 * Fetch Slack config for API responses, masking sensitive fields.
 */
export async function getSlackConfig(): Promise<SlackConfig | null> {
  const raw = await getSlackConfigRaw();
  if (!raw) return null;
  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    workspaceName: raw.workspaceName,
    // Show only the last 4 characters of secrets
    botToken: maskSecret(raw.botToken),
    signingSecret: maskSecret(raw.signingSecret),
    channelId: raw.channelId,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}

function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return "****" + value.slice(-4);
}

// ── Slack API Client ──────────────────────────────────────────────────────────

export interface SlackApiError {
  ok: false;
  error: string;
}

export interface SlackApiSuccess {
  ok: true;
  ts?: string;
  channel?: string;
}

export type SlackApiResult = SlackApiSuccess | SlackApiError;

/**
 * Send a plain-text message to a Slack channel.
 */
export async function sendSlackMessage(
  channel: string,
  text: string,
  botToken: string
): Promise<SlackApiResult> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, text }),
  });

  const data = (await res.json()) as SlackApiResult;
  return data;
}

/**
 * Send a Slack Block Kit message to a channel.
 */
export async function sendSlackBlocks(
  channel: string,
  blocks: unknown[],
  text: string,
  botToken: string
): Promise<SlackApiResult> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel, blocks, text }),
  });

  const data = (await res.json()) as SlackApiResult;
  return data;
}

/**
 * Post an ephemeral reply to a Slack slash command response_url.
 * This does NOT require a bot token — it uses the response_url from the command.
 */
export async function replyToSlashCommand(
  responseUrl: string,
  text: string,
  blocks?: unknown[]
): Promise<void> {
  const body: Record<string, unknown> = {
    response_type: "ephemeral",
    text,
  };
  if (blocks) body.blocks = blocks;

  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Block Kit Helpers ─────────────────────────────────────────────────────────

export function markdownBlock(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text } };
}

export function dividerBlock(): unknown {
  return { type: "divider" };
}

export function headerBlock(text: string): unknown {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}
