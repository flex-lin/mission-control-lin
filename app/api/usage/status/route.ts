import { ok, serverError } from "@/lib/api-helpers";
import { getAdminApiKey } from "@/lib/anthropic-usage";
import { db } from "@/lib/db";
import type { UsageSyncStatus } from "@/types";

// GET /api/usage/status — Sync status & config check
export async function GET() {
  try {
    const apiKey = await getAdminApiKey();

    const cursors = await db.usageSyncCursor.findMany();
    const cursorMap = new Map(cursors.map((c) => [c.id, c.lastSyncAt.toISOString()]));

    const status: UsageSyncStatus = {
      configured: !!apiKey,
      lastSync: {
        usage: cursorMap.get("usage") ?? null,
        cost: cursorMap.get("cost") ?? null,
        claudeCode: cursorMap.get("claude_code") ?? null,
      },
      keyPrefix: apiKey ? apiKey.slice(0, 8) + "…" : null,
    };

    return ok(status);
  } catch (e) {
    return serverError(e);
  }
}
