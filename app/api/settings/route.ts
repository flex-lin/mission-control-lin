import { NextRequest, NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/claude-files";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import type { Settings } from "@/types";

// GET /api/settings — read ~/.claude/settings.json + DB preferences
export async function GET(): Promise<NextResponse> {
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
    };

    return ok(merged);
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/settings — write settings (UI prefs go to DB, claude settings to file)
export async function PUT(req: NextRequest): Promise<NextResponse> {
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

    for (const { key, value } of dbUpdates) {
      await db.preference.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    // Claude-specific settings (env, permissions, model, hooks) → file
    const currentFile = readSettings();
    const {
      theme: _theme,
      refreshInterval: _ri,
      ...fileUpdates
    } = body;

    if (Object.keys(fileUpdates).length > 0) {
      writeSettings({ ...currentFile, ...fileUpdates });
    }

    return ok({ saved: true });
  } catch (e) {
    return serverError(e);
  }
}
