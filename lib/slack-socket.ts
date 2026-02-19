/**
 * Slack Socket Mode manager — singleton WebSocket connection to Slack.
 *
 * Follows the same singleton pattern as lib/proxy-manager.ts.
 * Uses @slack/socket-mode for the WebSocket connection and
 * @slack/web-api for sending replies.
 *
 * When an appToken (xapp-...) is configured, Socket Mode replaces
 * the HTTP webhook routes for events and slash commands.
 */
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { handleSlashCommand, type SlashCommandContext } from "@/lib/slack-commands";

let socketClient: SocketModeClient | null = null;
let webClient: WebClient | null = null;
let connected = false;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the Socket Mode connection.
 * No-ops if already running.
 */
export async function startSocketMode(
  appToken: string,
  botToken: string
): Promise<void> {
  if (socketClient && connected) {
    return;
  }

  // Clean up any previous client
  if (socketClient) {
    try {
      await socketClient.disconnect();
    } catch {
      // Ignore disconnect errors on stale client
    }
  }

  webClient = new WebClient(botToken);

  socketClient = new SocketModeClient({
    appToken,
    logLevel: undefined, // Use default logging
  });

  // Register event handlers before connecting
  registerEventHandlers(socketClient);

  // Connection lifecycle logging
  socketClient.on("connected", () => {
    connected = true;
    console.log("[slack-socket] Connected to Slack via Socket Mode");
  });

  socketClient.on("disconnected", () => {
    connected = false;
    console.log("[slack-socket] Disconnected from Slack Socket Mode");
  });

  socketClient.on("reconnecting", () => {
    console.log("[slack-socket] Reconnecting to Slack Socket Mode...");
  });

  socketClient.on("error", (error: Error) => {
    console.error("[slack-socket] Socket Mode error:", error.message);
  });

  await socketClient.start();
}

/**
 * Stop the Socket Mode connection cleanly.
 */
export async function stopSocketMode(): Promise<void> {
  if (socketClient) {
    try {
      await socketClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    socketClient = null;
    webClient = null;
    connected = false;
    console.log("[slack-socket] Socket Mode stopped");
  }
}

/**
 * Check whether Socket Mode is currently connected.
 */
export function isSocketModeRunning(): boolean {
  return connected && socketClient !== null;
}

/**
 * Get the current SocketModeClient instance (or null).
 */
export function getSocketModeClient(): SocketModeClient | null {
  return socketClient;
}

// ── Event Handlers ───────────────────────────────────────────────────────────

function registerEventHandlers(client: SocketModeClient): void {
  // Slash commands — Socket Mode receives these as "slash_commands" type
  client.on("slash_commands", async ({ body, ack }) => {
    // Acknowledge immediately
    const ctx: SlashCommandContext = {
      command: (body as Record<string, string>).command ?? "/mc",
      text: (body as Record<string, string>).text ?? "",
      userId: (body as Record<string, string>).user_id ?? "",
      userName: (body as Record<string, string>).user_name ?? "",
      channelId: (body as Record<string, string>).channel_id ?? "",
      teamId: (body as Record<string, string>).team_id ?? "",
    };

    try {
      const result = await handleSlashCommand(ctx);
      await ack({ text: result.text, response_type: result.response_type ?? "ephemeral" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error("[slack-socket] Slash command error:", message);
      await ack({ text: `Error: ${message}`, response_type: "ephemeral" });
    }
  });

  // App mention events
  client.on("app_mention", async ({ event, ack }) => {
    await ack();
    if (!webClient) return;

    const ev = event as { text?: string; channel?: string; user?: string; bot_id?: string };
    if (ev.bot_id || !ev.text || !ev.channel) return;

    // Strip bot mention from text (e.g., "<@U1234> status" -> "status")
    const text = ev.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return;

    void handleChatMessage(ev.channel, text);
  });

  // Direct messages
  client.on("message", async ({ event, ack }) => {
    await ack();
    if (!webClient) return;

    const ev = event as {
      text?: string;
      channel?: string;
      channel_type?: string;
      user?: string;
      bot_id?: string;
      subtype?: string;
    };

    // Only handle DMs (im) from real users, not bot messages or edits
    if (ev.channel_type !== "im" || ev.bot_id || ev.subtype || !ev.text || !ev.channel) return;

    void handleChatMessage(ev.channel, ev.text);
  });
}

/**
 * Forward a message to the Mission Control chatbot and reply in the channel.
 */
async function handleChatMessage(channel: string, text: string): Promise<void> {
  if (!webClient) return;

  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:31777";
    const chatRes = await fetch(`${baseUrl}/api/chatbot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: text }],
      }),
    });

    let replyText: string;
    if (chatRes.ok) {
      const chatData = (await chatRes.json()) as { reply?: string; error?: string };
      replyText = chatData.reply ?? "No response from chatbot";
    } else {
      replyText = "Sorry, I encountered an error processing your request.";
    }

    await webClient.chat.postMessage({ channel, text: replyText });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[slack-socket] Error handling chat message:", message);

    try {
      await webClient.chat.postMessage({ channel, text: `Error: ${message}` });
    } catch {
      // Ignore secondary error
    }
  }
}
