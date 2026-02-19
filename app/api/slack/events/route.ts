/**
 * POST /api/slack/events — Slack Events API webhook handler.
 *
 * Handles:
 *   - url_verification challenge (initial Slack setup)
 *   - message events (forwards to chatbot, replies in channel)
 *
 * See: https://api.slack.com/events-api
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, getSlackConfigRaw, sendSlackMessage } from "@/lib/slack";

// Slack Events API payload types
interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
  token: string;
}

interface SlackMessageEvent {
  type: "message";
  channel: string;
  user: string;
  text: string;
  ts: string;
  bot_id?: string;
  subtype?: string;
}

interface SlackEventCallback {
  type: "event_callback";
  event: SlackMessageEvent;
  team_id: string;
  api_app_id: string;
}

type SlackPayload = SlackUrlVerification | SlackEventCallback | { type: string };

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body for signature verification
  const rawBody = await req.text();

  // Parse JSON
  let payload: SlackPayload;
  try {
    payload = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle url_verification — Slack sends this during initial app setup.
  // Require a valid challenge string to prevent endpoint fingerprinting abuse.
  if (payload.type === "url_verification") {
    const uvPayload = payload as SlackUrlVerification;
    if (!uvPayload.challenge || typeof uvPayload.challenge !== "string") {
      return NextResponse.json({ error: "Missing challenge" }, { status: 400 });
    }
    // Verify Slack config exists — refuse if app is not configured at all
    const configCheck = await getSlackConfigRaw();
    if (!configCheck) {
      return NextResponse.json({ error: "Not configured" }, { status: 404 });
    }
    return NextResponse.json({ challenge: uvPayload.challenge });
  }

  // For all other events, verify signature
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  const config = await getSlackConfigRaw();
  if (!config) {
    return NextResponse.json(
      { error: "Slack not configured" },
      { status: 503 }
    );
  }

  if (!config.signingSecret) {
    return NextResponse.json(
      { error: "Signing secret not configured (HTTP mode requires signingSecret)" },
      { status: 503 }
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

  // Handle event callbacks
  if (payload.type === "event_callback") {
    const eventPayload = payload as SlackEventCallback;
    const event = eventPayload.event;

    // Only handle regular user messages (not bot messages, not message edits)
    if (
      event.type === "message" &&
      !event.bot_id &&
      !event.subtype &&
      event.text
    ) {
      // Process asynchronously — Slack expects a 200 response within 3 seconds
      void handleMessageEvent(event, config.botToken);
    }
  }

  // Always return 200 quickly so Slack doesn't retry
  return NextResponse.json({ ok: true });
}

async function handleMessageEvent(
  event: SlackMessageEvent,
  botToken: string
): Promise<void> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3777";

    // Forward the user's message to the Mission Control chatbot
    const chatRes = await fetch(`${baseUrl}/api/chatbot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: event.text,
          },
        ],
      }),
    });

    let replyText: string;

    if (chatRes.ok) {
      const chatData = (await chatRes.json()) as { reply?: string; error?: string };
      replyText = chatData.reply ?? "No response from chatbot";
    } else {
      replyText = "Sorry, I encountered an error processing your request.";
    }

    // Reply in the same channel
    await sendSlackMessage(event.channel, replyText, botToken);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[slack/events] Error handling message event:", message);

    // Best-effort error reply
    try {
      await sendSlackMessage(
        event.channel,
        `Error: ${message}`,
        botToken
      );
    } catch {
      // Ignore secondary error
    }
  }
}
