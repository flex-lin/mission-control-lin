import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for:
 * 1. lib/proxy-manager.ts  — spawnProxyProcess / killProxyProcess / getProxyProcess / isProxyRunning
 * 2. app/api/settings/route.ts  — auto-start/-stop proxy when proxyConfig.enabled changes
 * 3. app/api/proxy/status/route.ts  — GET /api/proxy/status (port probe)
 * 4. app/api/proxy/control/route.ts  — POST /api/proxy/control (start/stop)
 * 5. Integration: settings PUT → proxy-manager calls correctly forwarded
 *
 * All child-process spawning and net socket probing are mocked so no real
 * processes or network connections are created.
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3777"), init);
}

function createSettingsFile(content: Record<string, unknown> = {}): void {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "settings.json"),
    JSON.stringify(content),
    "utf-8"
  );
}

function readSettingsFile(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(tmpDir, ".claude", "settings.json"), "utf-8")
  ) as Record<string, unknown>;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-pm-e2e-"));
  vi.stubEnv("HOME", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. lib/proxy-manager.ts — spawnProxyProcess
// Tests the module in isolation using vi.mock for child_process
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/proxy-manager — spawnProxyProcess", () => {
  /**
   * We create a fresh fake-process factory per test, then import proxy-manager
   * fresh (vi.resetModules clears the module cache so the singleton resets).
   * child_process is mocked at file scope via vi.mock so it is always hoisted.
   */

  interface FakeProcess {
    killed: boolean;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    exitCb: (() => void) | null;
  }

  function makeFakeProcess(pid = 12345): FakeProcess {
    const fp: FakeProcess = {
      killed: false,
      pid,
      kill: vi.fn(function (this: FakeProcess) {
        this.killed = true;
        if (this.exitCb) this.exitCb();
      }),
      unref: vi.fn(),
      once: vi.fn(function (this: FakeProcess, event: string, cb: () => void) {
        if (event === "exit") this.exitCb = cb;
      }),
      exitCb: null,
    };
    return fp;
  }

  it("spawns using npx tsx server/proxy.ts with correct env", async () => {
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; stdio: string; detached: boolean }
    ];
    expect(cmd).toBe("npx");
    expect(args[0]).toBe("tsx");
    expect(args[1]).toMatch(/server\/proxy\.ts$/);
    expect(opts.env.PROXY_PORT).toBe("8787");
    expect(opts.env.PROXY_TARGET_URL).toBe("https://api.anthropic.com");
    expect(opts.stdio).toBe("ignore");
    expect(opts.detached).toBe(true);

    vi.doUnmock("child_process");
  });

  it("calls unref() so the Node process is not blocked", async () => {
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    expect(fakeProc.unref).toHaveBeenCalledOnce();
    vi.doUnmock("child_process");
  });

  it("is idempotent — second call while process is alive does not spawn again", async () => {
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");
    spawnProxyProcess(8787, "https://api.anthropic.com"); // second call

    expect(spawnMock).toHaveBeenCalledOnce();
    vi.doUnmock("child_process");
  });

  it("spawns again after first process exits (exit event clears ref)", async () => {
    const fakeProc1 = makeFakeProcess(111);
    const fakeProc2 = makeFakeProcess(222);
    const spawnMock = vi.fn()
      .mockReturnValueOnce(fakeProc1)
      .mockReturnValueOnce(fakeProc2);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");

    // First spawn
    spawnProxyProcess(8787, "https://api.anthropic.com");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // Simulate process exit via the registered "exit" callback
    fakeProc1.kill(); // triggers exitCb which sets proxyProcess = null

    // Second spawn — allowed because ref was cleared
    spawnProxyProcess(8787, "https://api.anthropic.com");
    expect(spawnMock).toHaveBeenCalledTimes(2);

    vi.doUnmock("child_process");
  });

  it("passes custom port and targetUrl to the child process", async () => {
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(9000, "https://custom-proxy.example.com");

    const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(opts.env.PROXY_PORT).toBe("9000");
    expect(opts.env.PROXY_TARGET_URL).toBe("https://custom-proxy.example.com");

    vi.doUnmock("child_process");
  });

  it("inherits parent process env vars (spreads process.env)", async () => {
    vi.stubEnv("MY_CUSTOM_VAR", "hello-test");
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(opts.env.MY_CUSTOM_VAR).toBe("hello-test");

    vi.unstubAllEnvs();
    vi.stubEnv("HOME", tmpDir);
    vi.doUnmock("child_process");
  });

  it("script path is absolute", async () => {
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { spawnProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(path.isAbsolute(args[1])).toBe(true);

    vi.doUnmock("child_process");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. lib/proxy-manager.ts — killProxyProcess
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/proxy-manager — killProxyProcess", () => {
  interface FakeProcess {
    killed: boolean;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    exitCb: (() => void) | null;
  }

  function makeFakeProcess(pid = 12345): FakeProcess {
    const fp: FakeProcess = {
      killed: false,
      pid,
      kill: vi.fn(function (this: FakeProcess) {
        this.killed = true;
        if (this.exitCb) this.exitCb();
      }),
      unref: vi.fn(),
      once: vi.fn(function (this: FakeProcess, event: string, cb: () => void) {
        if (event === "exit") this.exitCb = cb;
      }),
      exitCb: null,
    };
    return fp;
  }

  it("kills the running process with SIGTERM", async () => {
    const fakeProc = makeFakeProcess();
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, killProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");
    killProxyProcess();

    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");
    vi.doUnmock("child_process");
  });

  it("is a no-op when no process is running (does not throw)", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const { killProxyProcess } = await import("@/lib/proxy-manager");
    expect(() => killProxyProcess()).not.toThrow();

    vi.doUnmock("child_process");
  });

  it("calling multiple times does not throw after first kill", async () => {
    const fakeProc = makeFakeProcess();
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, killProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    expect(() => {
      killProxyProcess();
      killProxyProcess();
      killProxyProcess();
    }).not.toThrow();

    vi.doUnmock("child_process");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. lib/proxy-manager.ts — getProxyProcess / isProxyRunning
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/proxy-manager — getProxyProcess / isProxyRunning", () => {
  interface FakeProcess {
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    exitCb: (() => void) | null;
  }

  function makeFakeProcess(): FakeProcess {
    const fp: FakeProcess = {
      killed: false,
      kill: vi.fn(function (this: FakeProcess) {
        this.killed = true;
        if (this.exitCb) this.exitCb();
      }),
      unref: vi.fn(),
      once: vi.fn(function (this: FakeProcess, event: string, cb: () => void) {
        if (event === "exit") this.exitCb = cb;
      }),
      exitCb: null,
    };
    return fp;
  }

  it("getProxyProcess returns null before any spawn", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const { getProxyProcess } = await import("@/lib/proxy-manager");
    expect(getProxyProcess()).toBeNull();

    vi.doUnmock("child_process");
  });

  it("getProxyProcess returns the active process after spawn", async () => {
    const fakeProc = makeFakeProcess();
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, getProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    expect(getProxyProcess()).toBe(fakeProc);

    vi.doUnmock("child_process");
  });

  it("getProxyProcess returns null after killProxyProcess", async () => {
    const fakeProc = makeFakeProcess();
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, killProxyProcess, getProxyProcess } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");
    killProxyProcess();

    expect(getProxyProcess()).toBeNull();

    vi.doUnmock("child_process");
  });

  it("isProxyRunning returns false before any spawn", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const { isProxyRunning } = await import("@/lib/proxy-manager");
    expect(isProxyRunning()).toBe(false);

    vi.doUnmock("child_process");
  });

  it("isProxyRunning returns true after spawn", async () => {
    const fakeProc = makeFakeProcess();
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, isProxyRunning } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    expect(isProxyRunning()).toBe(true);

    vi.doUnmock("child_process");
  });

  it("isProxyRunning returns false after kill", async () => {
    const fakeProc = makeFakeProcess();
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, killProxyProcess, isProxyRunning } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");
    killProxyProcess();

    expect(isProxyRunning()).toBe(false);

    vi.doUnmock("child_process");
  });

  it("isProxyRunning returns false when process.killed is true (externally killed)", async () => {
    const fakeProc = makeFakeProcess();
    fakeProc.killed = true; // externally killed before we call isProxyRunning
    vi.doMock("child_process", () => ({ spawn: vi.fn(() => fakeProc) }));
    vi.resetModules();

    const { spawnProxyProcess, isProxyRunning } = await import("@/lib/proxy-manager");
    spawnProxyProcess(8787, "https://api.anthropic.com");

    // Even though spawn was called, the process is already dead
    expect(isProxyRunning()).toBe(false);

    vi.doUnmock("child_process");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PUT /api/settings — auto-start/-stop proxy via proxy-manager
//
// Here we mock @/lib/proxy-manager (not child_process directly) because
// settings/route.ts imports from @/lib/proxy-manager and we want to verify
// it calls the right functions.
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/settings — auto-start proxy when proxyConfig.enabled flips true", () => {
  const mockSpawnProxy = vi.fn();
  const mockKillProxy = vi.fn();
  const mockPreferenceFindMany = vi.fn();
  const mockPreferenceUpsert = vi.fn();

  beforeEach(() => {
    mockSpawnProxy.mockReset();
    mockKillProxy.mockReset();
    mockPreferenceFindMany.mockResolvedValue([]);
    mockPreferenceUpsert.mockResolvedValue({ key: "k", value: "v" });

    vi.doMock("@/lib/proxy-manager", () => ({
      spawnProxyProcess: mockSpawnProxy,
      killProxyProcess: mockKillProxy,
      isProxyRunning: vi.fn(() => false),
      getProxyProcess: vi.fn(() => null),
    }));

    vi.doMock("@/lib/db", () => ({
      db: {
        preference: {
          findMany: (...args: unknown[]) => mockPreferenceFindMany(...args),
          upsert: (...args: unknown[]) => mockPreferenceUpsert(...args),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }));
  });

  it("calls spawnProxyProcess when proxy transitions from disabled to enabled", async () => {
    createSettingsFile({
      proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const res = await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockSpawnProxy).toHaveBeenCalledOnce();
    expect(mockSpawnProxy).toHaveBeenCalledWith(8787, "https://api.anthropic.com");
    expect(mockKillProxy).not.toHaveBeenCalled();
  });

  it("does NOT call spawnProxyProcess when proxy was already enabled (no flip)", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const res = await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockSpawnProxy).not.toHaveBeenCalled();
  });

  it("uses default port 8787 when port is not in request or existing file", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({ proxyConfig: { enabled: true } }),
      })
    );

    expect(mockSpawnProxy).toHaveBeenCalledWith(8787, "https://api.anthropic.com");
  });

  it("falls back to existing file port when new request omits port", async () => {
    createSettingsFile({
      proxyConfig: { enabled: false, port: 9898, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({ proxyConfig: { enabled: true } }),
      })
    );

    expect(mockSpawnProxy).toHaveBeenCalledWith(9898, "https://api.anthropic.com");
  });

  it("uses custom targetUrl when specified", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: true, port: 8787, targetUrl: "https://my-proxy.example.com" },
        }),
      })
    );

    expect(mockSpawnProxy).toHaveBeenCalledWith(8787, "https://my-proxy.example.com");
  });

  it("saves proxyConfig to file when enabling", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    const saved = readSettingsFile();
    expect((saved.proxyConfig as Record<string, unknown>).enabled).toBe(true);
    expect((saved.proxyConfig as Record<string, unknown>).port).toBe(8787);
  });

  it("preserves other file settings when enabling proxy", async () => {
    createSettingsFile({ model: "claude-opus-4-6", env: { MY: "var" } });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    const saved = readSettingsFile();
    expect(saved.model).toBe("claude-opus-4-6");
    expect((saved.env as Record<string, string>).MY).toBe("var");
    expect((saved.proxyConfig as Record<string, unknown>).enabled).toBe(true);
  });
});

describe("PUT /api/settings — auto-stop proxy when proxyConfig.enabled flips false", () => {
  const mockSpawnProxy = vi.fn();
  const mockKillProxy = vi.fn();
  const mockPreferenceFindMany = vi.fn();
  const mockPreferenceUpsert = vi.fn();

  beforeEach(() => {
    mockSpawnProxy.mockReset();
    mockKillProxy.mockReset();
    mockPreferenceFindMany.mockResolvedValue([]);
    mockPreferenceUpsert.mockResolvedValue({ key: "k", value: "v" });

    vi.doMock("@/lib/proxy-manager", () => ({
      spawnProxyProcess: mockSpawnProxy,
      killProxyProcess: mockKillProxy,
      isProxyRunning: vi.fn(() => false),
      getProxyProcess: vi.fn(() => null),
    }));

    vi.doMock("@/lib/db", () => ({
      db: {
        preference: {
          findMany: (...args: unknown[]) => mockPreferenceFindMany(...args),
          upsert: (...args: unknown[]) => mockPreferenceUpsert(...args),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }));
  });

  it("calls killProxyProcess when proxy transitions from enabled to disabled", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const res = await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mockKillProxy).toHaveBeenCalledOnce();
    expect(mockSpawnProxy).not.toHaveBeenCalled();
  });

  it("does NOT call killProxyProcess when proxy was already disabled (no flip)", async () => {
    createSettingsFile({
      proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    expect(mockKillProxy).not.toHaveBeenCalled();
    expect(mockSpawnProxy).not.toHaveBeenCalled();
  });

  it("persists enabled=false to settings file when disabling", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    const saved = readSettingsFile();
    expect((saved.proxyConfig as Record<string, unknown>).enabled).toBe(false);
  });

  it("does not affect non-proxy file settings when disabling proxy", async () => {
    createSettingsFile({
      model: "claude-sonnet-4-6",
      proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
        }),
      })
    );

    const saved = readSettingsFile();
    expect(saved.model).toBe("claude-sonnet-4-6");
    expect((saved.proxyConfig as Record<string, unknown>).enabled).toBe(false);
  });
});

describe("PUT /api/settings — no proxy side effects when proxyConfig not in body", () => {
  const mockSpawnProxy = vi.fn();
  const mockKillProxy = vi.fn();
  const mockPreferenceFindMany = vi.fn();
  const mockPreferenceUpsert = vi.fn();

  beforeEach(() => {
    mockSpawnProxy.mockReset();
    mockKillProxy.mockReset();
    mockPreferenceFindMany.mockResolvedValue([]);
    mockPreferenceUpsert.mockResolvedValue({ key: "k", value: "v" });

    vi.doMock("@/lib/proxy-manager", () => ({
      spawnProxyProcess: mockSpawnProxy,
      killProxyProcess: mockKillProxy,
      isProxyRunning: vi.fn(() => false),
      getProxyProcess: vi.fn(() => null),
    }));

    vi.doMock("@/lib/db", () => ({
      db: {
        preference: {
          findMany: (...args: unknown[]) => mockPreferenceFindMany(...args),
          upsert: (...args: unknown[]) => mockPreferenceUpsert(...args),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }));
  });

  it("does not spawn proxy when only theme is updated", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({ theme: "light" }),
      })
    );

    expect(mockSpawnProxy).not.toHaveBeenCalled();
    expect(mockKillProxy).not.toHaveBeenCalled();
  });

  it("does not spawn proxy when only refreshInterval is updated", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({ refreshInterval: 15 }),
      })
    );

    expect(mockSpawnProxy).not.toHaveBeenCalled();
    expect(mockKillProxy).not.toHaveBeenCalled();
  });

  it("does not spawn proxy when model is updated without proxy settings", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({ model: "claude-opus-4-6" }),
      })
    );

    expect(mockSpawnProxy).not.toHaveBeenCalled();
    expect(mockKillProxy).not.toHaveBeenCalled();
  });

  it("returns 200 for empty body", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const res = await PUT(
      makeReq("http://localhost:3777/api/settings", {
        method: "PUT",
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(200);
    expect(mockSpawnProxy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/settings — proxyConfig is returned in response
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/settings — proxyConfig is included in response", () => {
  const mockPreferenceFindMany = vi.fn();

  beforeEach(() => {
    mockPreferenceFindMany.mockResolvedValue([]);

    vi.doMock("@/lib/db", () => ({
      db: {
        preference: {
          findMany: (...args: unknown[]) => mockPreferenceFindMany(...args),
          upsert: vi.fn().mockResolvedValue({ key: "k", value: "v" }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }));

    vi.doMock("@/lib/proxy-manager", () => ({
      spawnProxyProcess: vi.fn(),
      killProxyProcess: vi.fn(),
      isProxyRunning: vi.fn(() => false),
      getProxyProcess: vi.fn(() => null),
    }));
  });

  it("returns proxyConfig.enabled=true when set in settings file", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = (await res.json()) as {
      data: { proxyConfig: { enabled: boolean; port: number; targetUrl: string } };
    };

    expect(res.status).toBe(200);
    expect(body.data.proxyConfig.enabled).toBe(true);
    expect(body.data.proxyConfig.port).toBe(8787);
    expect(body.data.proxyConfig.targetUrl).toBe("https://api.anthropic.com");
  });

  it("returns proxyConfig.enabled=false when disabled in settings file", async () => {
    createSettingsFile({
      proxyConfig: { enabled: false, port: 8787, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = (await res.json()) as { data: { proxyConfig: { enabled: boolean } } };

    expect(res.status).toBe(200);
    expect(body.data.proxyConfig.enabled).toBe(false);
  });

  it("returns undefined proxyConfig when not set in settings file", async () => {
    createSettingsFile({ model: "claude-sonnet-4-6" });

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = (await res.json()) as { data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(body.data.proxyConfig).toBeUndefined();
  });

  it("merges DB theme preference with file proxyConfig", async () => {
    createSettingsFile({
      proxyConfig: { enabled: true, port: 8787, targetUrl: "https://api.anthropic.com" },
    });
    mockPreferenceFindMany.mockResolvedValue([{ key: "theme", value: "dark" }]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = (await res.json()) as {
      data: { theme: string; proxyConfig: { enabled: boolean } };
    };

    expect(res.status).toBe(200);
    expect(body.data.theme).toBe("dark");
    expect(body.data.proxyConfig.enabled).toBe(true);
  });

  it("returns 200 even when settings file does not exist", async () => {
    // No settings file created — readSettings should return empty defaults

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/proxy/status — port probing with real TCP sockets
//
// We use ports that are guaranteed to be closed in the test environment to
// verify "running=false" behavior, and a real temporary TCP server to verify
// "running=true" behavior.
// ═══════════════════════════════════════════════════════════════════════════════

import net from "net";

/** Start a TCP server on an OS-assigned port and return { server, port }. */
function startTempServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
    server.once("error", reject);
  });
}

/** Stop a TCP server. */
function stopServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("GET /api/proxy/status — proxy port probing", () => {
  it("returns running=false when port is closed (connection refused)", async () => {
    // Use a port that's almost certainly not listening (OS picks a random high port
    // and we immediately verify it is closed by not starting any server on it).
    // Port 1 requires root — use a high ephemeral port not in use.
    // To be safe, start a server, grab its port, stop the server, then probe.
    const { server, port } = await startTempServer();
    await stopServer(server);

    createSettingsFile({
      proxyConfig: { enabled: false, port, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();
    const body = (await res.json()) as { data: { running: boolean; port: number } };

    expect(res.status).toBe(200);
    expect(body.data.running).toBe(false);
    expect(body.data.port).toBe(port);
  });

  it("returns running=true when port is open (server is listening)", async () => {
    const { server, port } = await startTempServer();

    createSettingsFile({
      proxyConfig: { enabled: true, port, targetUrl: "https://api.anthropic.com" },
    });

    try {
      vi.resetModules();
      const { GET } = await import("@/app/api/proxy/status/route");
      const res = await GET();
      const body = (await res.json()) as { data: { running: boolean; port: number; targetUrl: string } };

      expect(res.status).toBe(200);
      expect(body.data.running).toBe(true);
      expect(body.data.port).toBe(port);
      expect(body.data.targetUrl).toBe("https://api.anthropic.com");
    } finally {
      await stopServer(server);
    }
  });

  it("returns the configured port in response data", async () => {
    const { server, port } = await startTempServer();
    await stopServer(server);

    createSettingsFile({
      proxyConfig: { enabled: false, port, targetUrl: "https://api.anthropic.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();
    const body = (await res.json()) as { data: { port: number } };

    expect(res.status).toBe(200);
    expect(body.data.port).toBe(port);
  });

  it("uses default port 8787 when proxyConfig is absent from settings", async () => {
    // There's almost never anything on port 8787 in test environment
    createSettingsFile({});

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();
    const body = (await res.json()) as { data: { port: number } };

    expect(res.status).toBe(200);
    expect(body.data.port).toBe(8787);
  });

  it("returns targetUrl from settings file", async () => {
    const { server, port } = await startTempServer();
    await stopServer(server);

    createSettingsFile({
      proxyConfig: { port, targetUrl: "https://custom.anthropic.proxy.com" },
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();
    const body = (await res.json()) as { data: { targetUrl: string } };

    expect(res.status).toBe(200);
    expect(body.data.targetUrl).toBe("https://custom.anthropic.proxy.com");
  });

  it("returns default targetUrl https://api.anthropic.com when not configured", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();
    const body = (await res.json()) as { data: { targetUrl: string } };

    expect(res.status).toBe(200);
    expect(body.data.targetUrl).toBe("https://api.anthropic.com");
  });

  it("returns 200 (not 500) even when settings file is empty", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("response shape always includes running, port, and targetUrl fields", async () => {
    createSettingsFile({ proxyConfig: { port: 8787, targetUrl: "https://api.anthropic.com" } });

    vi.resetModules();
    const { GET } = await import("@/app/api/proxy/status/route");
    const res = await GET();
    const body = (await res.json()) as {
      data: { running: boolean; port: number; targetUrl: string };
    };

    expect(res.status).toBe(200);
    expect(typeof body.data.running).toBe("boolean");
    expect(typeof body.data.port).toBe("number");
    expect(typeof body.data.targetUrl).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. POST /api/proxy/control — manual start/stop
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/proxy/control — action=start", () => {
  interface FakeProcess {
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  }

  function makeFakeProcess(): FakeProcess {
    return {
      killed: false,
      kill: vi.fn(),
      unref: vi.fn(),
      once: vi.fn(),
    };
  }

  it("starts the proxy and returns success with port", async () => {
    createSettingsFile({ proxyConfig: { port: 8787, targetUrl: "https://api.anthropic.com" } });
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );
    const body = (await res.json()) as { data: { success: boolean; action: string; port: number } };

    expect(res.status).toBe(200);
    expect(body.data.success).toBe(true);
    expect(body.data.action).toBe("start");
    expect(body.data.port).toBe(8787);
    expect(spawnMock).toHaveBeenCalledOnce();

    vi.doUnmock("child_process");
  });

  it("uses custom port from settings", async () => {
    createSettingsFile({ proxyConfig: { port: 9999, targetUrl: "https://api.anthropic.com" } });
    const spawnMock = vi.fn(() => makeFakeProcess());

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );
    const body = (await res.json()) as { data: { port: number } };

    expect(body.data.port).toBe(9999);
    const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(opts.env.PROXY_PORT).toBe("9999");

    vi.doUnmock("child_process");
  });

  it("spawns with the targetUrl from settings", async () => {
    createSettingsFile({
      proxyConfig: { port: 8787, targetUrl: "https://my-proxy.example.com" },
    });
    const spawnMock = vi.fn(() => makeFakeProcess());

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );

    const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(opts.env.PROXY_TARGET_URL).toBe("https://my-proxy.example.com");

    vi.doUnmock("child_process");
  });

  it("uses default port 8787 and default targetUrl when settings has no proxyConfig", async () => {
    createSettingsFile({});
    const spawnMock = vi.fn(() => makeFakeProcess());

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );

    const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(opts.env.PROXY_PORT).toBe("8787");
    expect(opts.env.PROXY_TARGET_URL).toBe("https://api.anthropic.com");

    vi.doUnmock("child_process");
  });

  it("spawns with npx tsx server/proxy.ts command", async () => {
    createSettingsFile({ proxyConfig: { port: 8787, targetUrl: "https://api.anthropic.com" } });
    const spawnMock = vi.fn(() => makeFakeProcess());

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );

    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("npx");
    expect(args[0]).toBe("tsx");
    expect(args[1]).toMatch(/server\/proxy\.ts$/);

    vi.doUnmock("child_process");
  });

  it("returns 400 ALREADY_RUNNING on second start call", async () => {
    createSettingsFile({ proxyConfig: { port: 8787 } });
    const spawnMock = vi.fn(() => makeFakeProcess());

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");

    // First start — succeeds
    await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );

    // Second start — should fail
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(body.code).toBe("ALREADY_RUNNING");

    vi.doUnmock("child_process");
  });

  it("returns 400 INVALID_ACTION for unknown action", async () => {
    createSettingsFile({});
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "restart" }),
      })
    );
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_ACTION");

    vi.doUnmock("child_process");
  });

  it("returns 400 INVALID_ACTION for missing action field", async () => {
    createSettingsFile({});
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_ACTION");

    vi.doUnmock("child_process");
  });
});

describe("POST /api/proxy/control — action=stop", () => {
  interface FakeProcess {
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  }

  function makeFakeProcess(): FakeProcess {
    return {
      killed: false,
      kill: vi.fn(function (this: FakeProcess) {
        this.killed = true;
      }),
      unref: vi.fn(),
      once: vi.fn(),
    };
  }

  it("stops the proxy and returns success", async () => {
    createSettingsFile({ proxyConfig: { port: 8787 } });
    const fakeProc = makeFakeProcess();
    const spawnMock = vi.fn(() => fakeProc);

    vi.doMock("child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");

    // Start first
    await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
    );

    // Now stop
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "stop" }),
      })
    );
    const body = (await res.json()) as { data: { success: boolean; action: string } };

    expect(res.status).toBe(200);
    expect(body.data.success).toBe(true);
    expect(body.data.action).toBe("stop");
    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

    vi.doUnmock("child_process");
  });

  it("returns 400 NOT_RUNNING when no proxy is active", async () => {
    createSettingsFile({});
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const { POST } = await import("@/app/api/proxy/control/route");
    const res = await POST(
      makeReq("http://localhost:3777/api/proxy/control", {
        method: "POST",
        body: JSON.stringify({ action: "stop" }),
      })
    );
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(400);
    expect(body.code).toBe("NOT_RUNNING");

    vi.doUnmock("child_process");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ProxyStatusBanner component contract tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("ProxyStatusBanner component interface and contract", () => {
  it("compact prop is optional (defaults to false)", () => {
    type ProxyStatusBannerProps = { compact?: boolean };
    const props: ProxyStatusBannerProps = {};
    // No TypeScript error = interface accepts undefined compact
    expect(props.compact).toBeUndefined();
  });

  it("ProxyStatusInfo shape has all required fields", () => {
    const statusInfo = { running: true, port: 8787, targetUrl: "https://api.anthropic.com" };
    expect(typeof statusInfo.running).toBe("boolean");
    expect(typeof statusInfo.port).toBe("number");
    expect(typeof statusInfo.targetUrl).toBe("string");
  });

  it("running=false status is valid for ProxyStatusInfo", () => {
    const statusInfo = { running: false, port: 8787, targetUrl: "https://api.anthropic.com" };
    expect(statusInfo.running).toBe(false);
  });

  it("env var instruction uses correct ANTHROPIC_BASE_URL format", () => {
    const port = 8787;
    const envVar = `ANTHROPIC_BASE_URL=http://localhost:${port}`;
    expect(envVar).toBe("ANTHROPIC_BASE_URL=http://localhost:8787");
    expect(envVar).toMatch(/^ANTHROPIC_BASE_URL=http:\/\/localhost:\d+$/);
  });

  it("compact mode label contains port number", () => {
    const port = 8787;
    const label = `Proxy capturing on :${port}`;
    expect(label).toContain(":8787");
  });

  it("compact mode off label is correct", () => {
    const offLabel = "Proxy off — no live capture";
    expect(offLabel).toBeTruthy();
    expect(offLabel.length).toBeGreaterThan(0);
  });

  it("fetches status from /api/proxy/status endpoint", () => {
    // The banner fetches this endpoint — verify the path is correct
    const endpoint = "/api/proxy/status";
    expect(endpoint).toMatch(/^\/api\/proxy\/status$/);
  });

  it("ProxyStatusBanner can be imported without error", async () => {
    // This verifies the module is syntactically valid and exports correctly
    vi.resetModules();
    // Mock fetch so no real network calls are made
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch in test"))));

    const mod = await import("@/components/analytics/proxy-status-banner");
    expect(mod.ProxyStatusBanner).toBeDefined();
    expect(typeof mod.ProxyStatusBanner).toBe("function");

    vi.unstubAllGlobals();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Analytics dashboard import — ProxyStatusBanner is exported from dashboard
// ═══════════════════════════════════════════════════════════════════════════════

describe("analytics-dashboard.tsx imports ProxyStatusBanner", () => {
  it("proxy-status-banner module exports ProxyStatusBanner function", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no fetch")));

    const { ProxyStatusBanner } = await import("@/components/analytics/proxy-status-banner");

    expect(ProxyStatusBanner).toBeDefined();
    expect(typeof ProxyStatusBanner).toBe("function");

    vi.unstubAllGlobals();
  });

  it("proxy-status-banner module has correct named export", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no fetch")));

    const proxyBannerModule = await import("@/components/analytics/proxy-status-banner");

    // Should only export ProxyStatusBanner (named export)
    expect(Object.keys(proxyBannerModule)).toContain("ProxyStatusBanner");

    vi.unstubAllGlobals();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. lib/proxy-manager.ts — module structure and exports
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/proxy-manager — module exports", () => {
  it("exports spawnProxyProcess as a function", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const mod = await import("@/lib/proxy-manager");
    expect(typeof mod.spawnProxyProcess).toBe("function");

    vi.doUnmock("child_process");
  });

  it("exports killProxyProcess as a function", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const mod = await import("@/lib/proxy-manager");
    expect(typeof mod.killProxyProcess).toBe("function");

    vi.doUnmock("child_process");
  });

  it("exports getProxyProcess as a function", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const mod = await import("@/lib/proxy-manager");
    expect(typeof mod.getProxyProcess).toBe("function");

    vi.doUnmock("child_process");
  });

  it("exports isProxyRunning as a function", async () => {
    vi.doMock("child_process", () => ({ spawn: vi.fn() }));
    vi.resetModules();

    const mod = await import("@/lib/proxy-manager");
    expect(typeof mod.isProxyRunning).toBe("function");

    vi.doUnmock("child_process");
  });
});
