import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/slack/manifest/route";
import type { SlackManifest } from "@/types";

/**
 * Tests for GET /api/slack/manifest endpoint
 */

function makeReq(params?: Record<string, string>) {
  const url = new URL("http://localhost:3777/api/slack/manifest");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/slack/manifest", () => {
  it("returns 200 with manifest data", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { manifest_json: SlackManifest; create_url: string } };
    expect(body.data).toBeDefined();
    expect(body.data.manifest_json).toBeDefined();
    expect(body.data.create_url).toBeDefined();
  });

  it("manifest has correct display_information", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    expect(body.data.manifest_json.display_information.name).toBe("Mission Control");
    expect(body.data.manifest_json.display_information.description).toBeTruthy();
  });

  it("manifest has bot_user with always_online true", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    expect(body.data.manifest_json.features.bot_user.always_online).toBe(true);
    expect(body.data.manifest_json.features.bot_user.display_name).toBe("Mission Control");
  });

  it("manifest includes /mc slash command", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    const cmds = body.data.manifest_json.features.slash_commands;
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    expect(cmds[0].command).toBe("/mc");
  });

  it("manifest includes required bot scopes", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    const scopes = body.data.manifest_json.oauth_config.scopes.bot;
    expect(scopes).toContain("chat:write");
    expect(scopes).toContain("commands");
    expect(scopes).toContain("app_mentions:read");
    expect(scopes).toContain("im:read");
  });

  it("manifest has socket_mode_enabled: true", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    expect(body.data.manifest_json.settings.socket_mode_enabled).toBe(true);
  });

  it("manifest includes event subscriptions for app_mention and message.im", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    const events = body.data.manifest_json.settings.event_subscriptions?.bot_events;
    expect(events).toContain("app_mention");
    expect(events).toContain("message.im");
  });

  it("domain parameter is reflected in webhook URLs", async () => {
    const res = await GET(makeReq({ domain: "https://my-server.example.com" }));
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    const requestUrl = body.data.manifest_json.settings.event_subscriptions?.request_url;
    expect(requestUrl).toMatch(/^https:\/\/my-server\.example\.com/);
  });

  it("auto-detects domain from host header when not provided", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    const requestUrl = body.data.manifest_json.settings.event_subscriptions?.request_url;
    // Should contain localhost from the test request
    expect(requestUrl).toMatch(/localhost/);
  });

  it("create_url points to api.slack.com/apps", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { create_url: string } };

    expect(body.data.create_url).toMatch(/^https:\/\/api\.slack\.com\/apps/);
  });

  it("create_url contains manifest_json parameter with URL-encoded JSON", async () => {
    const res = await GET(makeReq());
    const body = await res.json() as { data: { create_url: string; manifest_json: SlackManifest } };

    const url = new URL(body.data.create_url);
    const manifestParam = url.searchParams.get("manifest_json");
    expect(manifestParam).toBeTruthy();

    // Should be valid JSON when decoded
    const decoded = JSON.parse(manifestParam!) as SlackManifest;
    expect(decoded.display_information.name).toBe("Mission Control");
  });

  it("strips trailing slash from domain", async () => {
    const res = await GET(makeReq({ domain: "https://example.com/" }));
    const body = await res.json() as { data: { manifest_json: SlackManifest } };

    const requestUrl = body.data.manifest_json.settings.event_subscriptions?.request_url;
    expect(requestUrl).toBe("https://example.com/api/slack/events");
  });
});
