/**
 * POST /api/slack/slash — Slack slash command handler (HTTP mode).
 *
 * Handles /mc <subcommand> commands via HTTP webhook.
 * When Socket Mode is enabled, commands are handled in lib/slack-socket.ts instead.
 *
 * Slack sends slash commands as URL-encoded form data.
 * See: https://api.slack.com/interactivity/slash-commands
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, getSlackConfigRaw, replyToSlashCommand } from "@/lib/slack";
import { handleSlashCommand, type SlashCommandContext } from "@/lib/slack-commands";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Slack sends slash commands as application/x-www-form-urlencoded
  const rawBody = await req.text();

  // Verify signature
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  const config = await getSlackConfigRaw();
  if (!config) {
    return NextResponse.json(
      { response_type: "ephemeral", text: "Mission Control Slack integration is not configured." },
      { status: 200 }
    );
  }

  if (!config.signingSecret) {
    return NextResponse.json(
      { response_type: "ephemeral", text: "Signing secret not configured (HTTP mode requires signingSecret)." },
      { status: 200 }
    );
  }

  const isValid = await verifySlackSignature(
    rawBody,
    timestamp,
    signature,
    config.signingSecret
  );

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse URL-encoded form body
  const params = new URLSearchParams(rawBody);
  const ctx: SlashCommandContext = {
    command: params.get("command") ?? "/mc",
    text: params.get("text") ?? "",
    userId: params.get("user_id") ?? "",
    userName: params.get("user_name") ?? "",
    channelId: params.get("channel_id") ?? "",
    teamId: params.get("team_id") ?? "",
  };
  const responseUrl = params.get("response_url") ?? "";

  // Send immediate acknowledgement and process asynchronously
  void processCommand(ctx, responseUrl);

  // Immediate response to prevent Slack timeout (3 second limit)
  return NextResponse.json({
    response_type: "ephemeral",
    text: "Processing your request...",
  });
}

async function processCommand(ctx: SlashCommandContext, responseUrl: string): Promise<void> {
  try {
    const result = await handleSlashCommand(ctx);
    await replyToSlashCommand(responseUrl, result.text, result.blocks);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[slack/slash] Error processing command:", message);
    await replyToSlashCommand(responseUrl, `Error processing command: ${message}`);
  }
}
