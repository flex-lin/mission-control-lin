import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for lib/slack-socket.ts Socket Mode manager.
 *
 * Mocks @slack/socket-mode and @slack/web-api to test manager lifecycle.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSocketStart = vi.fn();
const mockSocketDisconnect = vi.fn();
const mockSocketOn = vi.fn();

vi.mock("@slack/socket-mode", () => {
  class MockSocketModeClient {
    start = mockSocketStart;
    disconnect = mockSocketDisconnect;
    on = mockSocketOn;
  }
  return { SocketModeClient: MockSocketModeClient };
});

vi.mock("@slack/web-api", () => {
  class MockWebClient {
    chat = { postMessage: vi.fn() };
  }
  return { WebClient: MockWebClient };
});

vi.mock("@/lib/slack-commands", () => ({
  handleSlashCommand: vi.fn().mockResolvedValue({ text: "ok", response_type: "ephemeral" }),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  startSocketMode,
  stopSocketMode,
  isSocketModeRunning,
  getSocketModeClient,
} from "@/lib/slack-socket";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();
  mockSocketStart.mockResolvedValue(undefined);
  mockSocketDisconnect.mockResolvedValue(undefined);

  // Simulate the "connected" event firing after start
  mockSocketOn.mockImplementation((event: string, handler: () => void) => {
    if (event === "connected") {
      // Fire connected callback on next tick after start
      mockSocketStart.mockImplementation(async () => {
        handler();
      });
    }
  });

  // Ensure clean state by stopping any existing connection
  await stopSocketMode();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("slack-socket manager", () => {
  it("isSocketModeRunning returns false initially", () => {
    expect(isSocketModeRunning()).toBe(false);
  });

  it("getSocketModeClient returns null initially", () => {
    expect(getSocketModeClient()).toBeNull();
  });

  it("startSocketMode creates a client and calls start()", async () => {
    await startSocketMode("xapp-test-token", "xoxb-bot-token");

    expect(mockSocketStart).toHaveBeenCalledOnce();
  });

  it("startSocketMode sets isSocketModeRunning to true after connected event", async () => {
    await startSocketMode("xapp-test-token", "xoxb-bot-token");

    expect(isSocketModeRunning()).toBe(true);
  });

  it("getSocketModeClient returns client after start", async () => {
    await startSocketMode("xapp-test-token", "xoxb-bot-token");

    expect(getSocketModeClient()).not.toBeNull();
  });

  it("startSocketMode no-ops if already connected", async () => {
    await startSocketMode("xapp-test-token", "xoxb-bot-token");
    await startSocketMode("xapp-test-token", "xoxb-bot-token");

    // start() should only be called once (second call no-ops)
    expect(mockSocketStart).toHaveBeenCalledOnce();
  });

  it("stopSocketMode disconnects and resets state", async () => {
    await startSocketMode("xapp-test-token", "xoxb-bot-token");
    await stopSocketMode();

    expect(mockSocketDisconnect).toHaveBeenCalled();
    expect(isSocketModeRunning()).toBe(false);
    expect(getSocketModeClient()).toBeNull();
  });

  it("stopSocketMode is safe to call when not running", async () => {
    await stopSocketMode();

    expect(isSocketModeRunning()).toBe(false);
  });

  it("registers event handlers including slash_commands, app_mention, message", async () => {
    await startSocketMode("xapp-test-token", "xoxb-bot-token");

    const registeredEvents = mockSocketOn.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(registeredEvents).toContain("slash_commands");
    expect(registeredEvents).toContain("app_mention");
    expect(registeredEvents).toContain("message");
    expect(registeredEvents).toContain("connected");
    expect(registeredEvents).toContain("disconnected");
    expect(registeredEvents).toContain("error");
  });
});
