import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, err, serverError } from "@/lib/api-helpers";
import type { UsageLimits } from "@/types";

const LIMIT_KEYS: (keyof UsageLimits)[] = [
  "dailyTokens",
  "dailyCost",
  "monthlyTokens",
  "monthlyCost",
];

/** Map from UsageLimits field name to Preference table key */
const PREF_KEY_MAP: Record<keyof UsageLimits, string> = {
  dailyTokens: "usage_limit_daily_tokens",
  dailyCost: "usage_limit_daily_cost",
  monthlyTokens: "usage_limit_monthly_tokens",
  monthlyCost: "usage_limit_monthly_cost",
};

// GET /api/settings/usage-limits — read configured usage limits
export async function GET(): Promise<NextResponse> {
  try {
    const prefs = await db.preference.findMany({
      where: { key: { startsWith: "usage_limit_" } },
    });

    const map = new Map(prefs.map((p) => [p.key, p.value]));

    const limits: UsageLimits = {
      dailyTokens: parseLimit(map.get(PREF_KEY_MAP.dailyTokens)),
      dailyCost: parseLimit(map.get(PREF_KEY_MAP.dailyCost)),
      monthlyTokens: parseLimit(map.get(PREF_KEY_MAP.monthlyTokens)),
      monthlyCost: parseLimit(map.get(PREF_KEY_MAP.monthlyCost)),
    };

    return ok(limits);
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/settings/usage-limits — save usage limits
export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<UsageLimits>;

    for (const field of LIMIT_KEYS) {
      if (!(field in body)) continue;

      const value = body[field];
      const key = PREF_KEY_MAP[field];

      if (value === null || value === undefined) {
        // Remove the limit
        await db.preference.deleteMany({ where: { key } });
      } else {
        if (typeof value !== "number" || value < 0) {
          return err(`Invalid value for ${field}: must be a non-negative number`, "INVALID_LIMIT");
        }
        await db.preference.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        });
      }
    }

    return ok({ saved: true });
  } catch (e) {
    return serverError(e);
  }
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
