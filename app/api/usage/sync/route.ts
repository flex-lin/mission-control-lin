import { NextRequest } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import { getAdminApiKey, syncUsageData } from "@/lib/anthropic-usage";
import type { SyncOptions } from "@/lib/anthropic-usage";

// POST /api/usage/sync — Trigger sync from Anthropic APIs
export async function POST(req: NextRequest) {
  try {
    const apiKey = await getAdminApiKey();
    if (!apiKey) {
      return err(
        "No Admin API key configured. Set ANTHROPIC_ADMIN_API_KEY env var or add it in Settings.",
        "NO_API_KEY",
        400,
      );
    }

    const body = (await req.json().catch(() => ({}))) as Partial<SyncOptions>;

    const result = await syncUsageData(apiKey, {
      sources: body.sources,
      startDate: body.startDate,
      endDate: body.endDate,
      bucketWidth: body.bucketWidth,
      groupBy: body.groupBy,
    });

    return ok(result);
  } catch (e) {
    return serverError(e);
  }
}
