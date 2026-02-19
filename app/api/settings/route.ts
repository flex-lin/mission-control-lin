import { NextRequest } from "next/server";
import { readSettings, writeSettings, setProjectProxyEnv } from "@/lib/claude-files";
import { db } from "@/lib/db";
import { ok, err, serverError, validateUrl } from "@/lib/api-helpers";
import { spawnProxyProcess, killProxyProcess } from "@/lib/proxy-manager";
import type { Settings } from "@/types";

// Only these top-level keys are allowed to be written to the settings file.
// Prevents injection of arbitrary configuration keys via the PUT endpoint.
const ALLOWED_FILE_KEYS = new Set([
  "proxyConfig", "backgroundExecution", "env", "permissions",
  "model", "hooks", "teammateMode", "mcpServers",
]);

// GET /api/settings — read ~/.claude/settings.json + DB preferences
export async function GET() {
  try {
    const fileSettings = readSettings();

    // Load preferences from DB (theme, refreshInterval, etc.)
    const prefs = await db.preference.findMany();
    const dbPrefs: Record<string, string> = Object.fromEntries(
      prefs.map((p) => [p.key, p.value])
    );

    // Merge: DB prefs override file settings for UI preferences
    const merged: Settings = {
      ...fileSettings,
      ...(dbPrefs.theme && { theme: dbPrefs.theme as Settings["theme"] }),
      ...(dbPrefs.refreshInterval && {
        refreshInterval: Number(dbPrefs.refreshInterval),
      }),
      ...(dbPrefs.chatProvider && {
        chatProvider: dbPrefs.chatProvider as Settings["chatProvider"],
      }),
    };

    return ok(merged);
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/settings — write settings (UI prefs go to DB, claude settings to file)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Settings>;

    // UI preferences → DB
    const dbUpdates: Array<{ key: string; value: string }> = [];
    if (body.theme !== undefined) {
      dbUpdates.push({ key: "theme", value: body.theme });
    }
    if (body.refreshInterval !== undefined) {
      dbUpdates.push({ key: "refreshInterval", value: String(body.refreshInterval) });
    }
    if (body.chatProvider !== undefined) {
      dbUpdates.push({ key: "chatProvider", value: body.chatProvider });
    }

    for (const { key, value } of dbUpdates) {
      await db.preference.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    // Claude-specific settings (env, permissions, model, hooks, proxy) → file
    // Only allow known keys to prevent arbitrary config injection
    const currentFile = readSettings();
    const {
      theme: _theme,
      refreshInterval: _ri,
      chatProvider: _cp,
      ...rawFileUpdates
    } = body;

    const fileUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawFileUpdates)) {
      if (ALLOWED_FILE_KEYS.has(key)) {
        fileUpdates[key] = value;
      }
    }

    if (Object.keys(fileUpdates).length > 0) {
      writeSettings({ ...currentFile, ...fileUpdates });
    }

    // Auto-start or stop proxy when proxyConfig.enabled changes
    if (body.proxyConfig !== undefined) {
      const wasEnabled = currentFile.proxyConfig?.enabled ?? false;
      const nowEnabled = body.proxyConfig.enabled ?? false;
      const port = body.proxyConfig.port ?? currentFile.proxyConfig?.port ?? 28787;
      const targetUrl = body.proxyConfig.targetUrl ?? currentFile.proxyConfig?.targetUrl ?? "https://api.anthropic.com";

      if (!wasEnabled && nowEnabled) {
        // Validate targetUrl before spawning to prevent SSRF
        const urlCheck = validateUrl(targetUrl, "proxyConfig.targetUrl");
        if (!urlCheck.valid) return urlCheck.error;
        // User turned on proxy — start the process
        spawnProxyProcess(port, targetUrl);
        // Set ANTHROPIC_BASE_URL in project settings so Claude Code routes through proxy
        setProjectProxyEnv(`http://localhost:${port}`);
      } else if (wasEnabled && !nowEnabled) {
        // User turned off proxy — stop the process
        killProxyProcess();
        // Remove ANTHROPIC_BASE_URL so Claude Code goes directly to Anthropic
        setProjectProxyEnv(null);
      } else if (nowEnabled) {
        // Proxy stays enabled but port/targetUrl may have changed — update env
        setProjectProxyEnv(`http://localhost:${port}`);
      }
    }

    return ok({ saved: true });
  } catch (e) {
    return serverError(e);
  }
}
