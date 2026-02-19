/**
 * GET /api/slack/manifest — Generate a Slack App Manifest for one-click app creation.
 *
 * Query params:
 *   ?domain=https://example.com  — base URL for webhook endpoints (optional)
 *
 * Returns manifest JSON and a pre-built Slack app creation URL.
 */
import { NextRequest } from "next/server";
import { ok, serverError } from "@/lib/api-helpers";
import type { SlackManifest } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let domain = searchParams.get("domain") ?? "";

    // Auto-detect domain from request headers if not provided
    if (!domain) {
      const host = req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") ?? "http";
      if (host) {
        domain = `${proto}://${host}`;
      } else {
        domain = "http://localhost:3777";
      }
    }

    // Strip trailing slash
    domain = domain.replace(/\/+$/, "");

    const manifest: SlackManifest = {
      display_information: {
        name: "Mission Control",
        description: "Agent team dashboard — manage queues, teams, and tasks from Slack",
        background_color: "#1a1a2e",
      },
      features: {
        bot_user: {
          display_name: "Mission Control",
          always_online: true,
        },
        slash_commands: [
          {
            command: "/mc",
            description: "Interact with Mission Control (help, status, teams, queue)",
            usage_hint: "[help|status|teams|queue list|queue add <goal>]",
          },
        ],
      },
      oauth_config: {
        scopes: {
          bot: [
            "chat:write",
            "app_mentions:read",
            "im:read",
            "im:write",
            "im:history",
            "commands",
          ],
        },
      },
      settings: {
        event_subscriptions: {
          request_url: `${domain}/api/slack/events`,
          bot_events: ["app_mention", "message.im"],
        },
        socket_mode_enabled: true,
        org_deploy_enabled: false,
        interactivity: {
          is_enabled: false,
        },
      },
    };

    const manifestJson = JSON.stringify(manifest);
    const createUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifestJson)}`;

    return ok({
      manifest_json: manifest,
      create_url: createUrl,
    });
  } catch (e) {
    return serverError(e);
  }
}
