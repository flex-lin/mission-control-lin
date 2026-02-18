/**
 * Analytics Timezone Tests
 *
 * Tests that the analytics graph reflects actual usage based on EST/local time,
 * not UTC. The core issue: timestamps are stored via SQLite's datetime('now')
 * which is UTC, and date grouping uses .toISOString().slice(0, 10) which also
 * extracts UTC dates. This means usage at 10 PM EST on 2/18 shows as 2/19 on
 * the graph (because 10 PM EST = 3 AM UTC on 2/19).
 *
 * These tests verify:
 * 1. getCutoffDate timezone behavior (uses new Date() — server local time)
 * 2. Analytics API date grouping (UTC vs local)
 * 3. Date boundary edge cases (late-night EST = next-day UTC)
 * 4. Chart date formatting (how dates are rendered for the user)
 * 5. Proxy timestamp storage format
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCutoffDate } from "@/lib/analytics-helpers";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. getCutoffDate timezone sensitivity
// ═══════════════════════════════════════════════════════════════════════════════

describe("getCutoffDate — timezone sensitivity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses new Date() which is affected by system timezone", () => {
    // getCutoffDate calls `new Date()` to get "now".
    // On a server in UTC, this is UTC time.
    // On a dev machine in EST, this is EST time.
    // The cutoff is computed relative to "now", but the DB stores UTC timestamps.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T04:00:00Z")); // midnight EST = 4 AM UTC

    const cutoff = getCutoffDate("7d");
    // The cutoff date is 7 days before "now" in the system's local interpretation
    // In UTC: 2026-02-11T04:00:00Z
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-11");
  });

  it("cutoff at 11 PM EST (4 AM UTC next day) — the problematic boundary", () => {
    vi.useFakeTimers();
    // 11 PM EST on Feb 18 = 4 AM UTC on Feb 19
    vi.setSystemTime(new Date("2026-02-19T04:00:00Z"));

    const cutoff = getCutoffDate("7d");
    // 7 days before 2026-02-19T04:00:00Z = 2026-02-12T04:00:00Z
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-12");
    // This means a log from 2026-02-12T00:00:00Z (8 PM EST on 2/11) would be
    // EXCLUDED, even though it falls within "7 days ago" in EST
  });

  it("cutoff date includes the full boundary day when crossing midnight UTC", () => {
    vi.useFakeTimers();
    // 7 PM EST on Feb 18 = midnight UTC on Feb 19
    vi.setSystemTime(new Date("2026-02-19T00:00:00Z"));

    const cutoff = getCutoffDate("7d");
    // 7 days before midnight UTC Feb 19 = midnight UTC Feb 12
    expect(cutoff.toISOString()).toBe("2026-02-12T00:00:00.000Z");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Date grouping in analytics — the core bug
// ═══════════════════════════════════════════════════════════════════════════════

describe("Analytics date grouping — UTC vs local time", () => {
  it("toISOString().slice(0,10) groups by UTC date, not local date", () => {
    // This is the exact logic from app/api/analytics/route.ts:24
    // and app/(dashboard)/analytics/page.tsx:49
    //
    // A request at 10 PM EST on Feb 18 is stored as 3 AM UTC on Feb 19
    const timestamp = new Date("2026-02-19T03:00:00Z"); // 10 PM EST on 2/18
    const dateKey = timestamp.toISOString().slice(0, 10);

    // BUG: This shows as 2026-02-19, but the user made the request on 2/18 EST
    expect(dateKey).toBe("2026-02-19");
    // It should ideally be "2026-02-18" for an EST user
  });

  it("demonstrates the off-by-one day error for late-night EST usage", () => {
    // Simulate what happens in the analytics aggregation
    const logs = [
      // Request at 8 PM EST on Feb 17 = 1 AM UTC on Feb 18
      { timestamp: new Date("2026-02-18T01:00:00Z"), inputTokens: 1000, outputTokens: 500 },
      // Request at 11 PM EST on Feb 17 = 4 AM UTC on Feb 18
      { timestamp: new Date("2026-02-18T04:00:00Z"), inputTokens: 2000, outputTokens: 1000 },
      // Request at 2 PM EST on Feb 18 = 7 PM UTC on Feb 18
      { timestamp: new Date("2026-02-18T19:00:00Z"), inputTokens: 3000, outputTokens: 1500 },
      // Request at 10 PM EST on Feb 18 = 3 AM UTC on Feb 19
      { timestamp: new Date("2026-02-19T03:00:00Z"), inputTokens: 4000, outputTokens: 2000 },
    ];

    // Replicate the grouping logic from analytics/route.ts
    const byDateUTC = new Map<string, { totalInput: number; totalOutput: number }>();
    for (const log of logs) {
      const date = log.timestamp.toISOString().slice(0, 10);
      const existing = byDateUTC.get(date) ?? { totalInput: 0, totalOutput: 0 };
      byDateUTC.set(date, {
        totalInput: existing.totalInput + log.inputTokens,
        totalOutput: existing.totalOutput + log.outputTokens,
      });
    }

    // UTC grouping: Feb 18 gets 3 entries, Feb 19 gets 1
    expect(byDateUTC.get("2026-02-18")).toEqual({ totalInput: 6000, totalOutput: 3000 });
    expect(byDateUTC.get("2026-02-19")).toEqual({ totalInput: 4000, totalOutput: 2000 });

    // But EST grouping should be: Feb 17 gets 2 entries, Feb 18 gets 2 entries
    // The user sees their 10 PM usage on the WRONG day in the graph
    const byDateEST = new Map<string, { totalInput: number; totalOutput: number }>();
    for (const log of logs) {
      // Convert to EST (UTC-5) for correct local grouping
      const estDate = new Date(log.timestamp.getTime() - 5 * 60 * 60 * 1000);
      const date = estDate.toISOString().slice(0, 10);
      const existing = byDateEST.get(date) ?? { totalInput: 0, totalOutput: 0 };
      byDateEST.set(date, {
        totalInput: existing.totalInput + log.inputTokens,
        totalOutput: existing.totalOutput + log.outputTokens,
      });
    }

    // EST grouping: Feb 17 gets first 2, Feb 18 gets last 2
    expect(byDateEST.get("2026-02-17")).toEqual({ totalInput: 3000, totalOutput: 1500 });
    expect(byDateEST.get("2026-02-18")).toEqual({ totalInput: 7000, totalOutput: 3500 });
  });

  it("all usage between 7PM-midnight EST shows on wrong day in UTC grouping", () => {
    // The "danger zone": 7 PM EST (00:00 UTC) to 11:59 PM EST (04:59 UTC)
    // Any usage in this window gets attributed to the next calendar day in UTC
    const dangerZoneTimestamps = [
      new Date("2026-02-19T00:00:00Z"), // 7 PM EST on 2/18
      new Date("2026-02-19T01:30:00Z"), // 8:30 PM EST on 2/18
      new Date("2026-02-19T03:00:00Z"), // 10 PM EST on 2/18
      new Date("2026-02-19T04:59:00Z"), // 11:59 PM EST on 2/18
    ];

    for (const ts of dangerZoneTimestamps) {
      const utcDate = ts.toISOString().slice(0, 10);
      expect(utcDate).toBe("2026-02-19"); // All show as Feb 19 in UTC

      // But user was working on Feb 18 EST
      const estDate = new Date(ts.getTime() - 5 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      expect(estDate).toBe("2026-02-18"); // Should be Feb 18
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. The specific reported bug: "latest usage shows 2/17 but date is 2/18"
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reported bug: graph shows 2/17 when today is 2/18", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reproduces: usage after 7 PM EST on 2/17 shows as 2/18 in UTC graph", () => {
    // User's scenario: it's Feb 18 EST, but the graph shows latest usage as Feb 17
    // This could happen if the user's most recent activity was between
    // 7 PM and midnight EST on 2/17, which would show as 2/18 UTC in the graph.
    //
    // Wait — actually the bug is the REVERSE: the graph shows 2/17 as latest,
    // but the user expects to see 2/18. This means usage ON 2/18 EST is not
    // showing up as 2/18 in the graph.
    //
    // Scenario: user used the API during daytime 2/18 EST = 2/18 UTC (fine).
    // But if their usage was between midnight-7AM EST on 2/18 (= still 2/18 UTC),
    // that should show as 2/18 too. So the bug might be about the cutoff or
    // the "latest date" being 2/17 because there's no 2/18 usage yet in the graph.
    //
    // OR: The cutoff at "7d" excludes today's data somehow.

    vi.useFakeTimers();
    // It's currently midnight EST on Feb 18 = 5 AM UTC on Feb 18
    vi.setSystemTime(new Date("2026-02-18T05:00:00Z"));

    const cutoff = getCutoffDate("7d");
    // cutoff = 7 days ago from "now" = Feb 11 at 5 AM UTC
    expect(cutoff.toISOString()).toBe("2026-02-11T05:00:00.000Z");

    // A log from 11 PM EST on Feb 17 = 4 AM UTC on Feb 18
    const lateNightLog = new Date("2026-02-18T04:00:00Z");
    // This IS after the cutoff, so it's included in the query
    expect(lateNightLog >= cutoff).toBe(true);

    // But what date does it group under?
    const dateKey = lateNightLog.toISOString().slice(0, 10);
    expect(dateKey).toBe("2026-02-18"); // Shows as 2/18 UTC

    // For the user in EST, this was 11 PM on 2/17 — they'd expect it under 2/17
  });

  it("shows that today's EST usage may show as yesterday's UTC date", () => {
    vi.useFakeTimers();
    // It's 1 AM EST on Feb 18 = 6 AM UTC on Feb 18
    vi.setSystemTime(new Date("2026-02-18T06:00:00Z"));

    // A log created at midnight EST on Feb 18 = 5 AM UTC on Feb 18
    const todayESTLog = new Date("2026-02-18T05:00:00Z");
    const dateKey = todayESTLog.toISOString().slice(0, 10);

    // This actually groups correctly as 2/18 in UTC too
    // The issue is the opposite direction:
    expect(dateKey).toBe("2026-02-18");
  });

  it("graph missing today: no usage yet today UTC even though user is active in EST", () => {
    vi.useFakeTimers();
    // It's 3 PM EST on Feb 18 = 8 PM UTC on Feb 18
    vi.setSystemTime(new Date("2026-02-18T20:00:00Z"));

    // The user's last API call was 11 PM EST on Feb 17 = 4 AM UTC on Feb 18
    const lastLog = new Date("2026-02-18T04:00:00Z");
    const lastLogDateUTC = lastLog.toISOString().slice(0, 10);

    // In UTC, this shows as Feb 18 — which is correct!
    expect(lastLogDateUTC).toBe("2026-02-18");

    // But if the user's last API call was at 6 PM EST on Feb 17 = 11 PM UTC on Feb 17
    const earlierLog = new Date("2026-02-17T23:00:00Z");
    const earlierDateUTC = earlierLog.toISOString().slice(0, 10);

    // This shows as Feb 17 in UTC — ALSO correct in UTC
    expect(earlierDateUTC).toBe("2026-02-17");

    // The real problem: if ALL usage on Feb 17 happened before 7 PM EST,
    // the graph correctly shows Feb 17 as the latest day.
    // But on Feb 18 EST, the user expects to see a Feb 18 entry.
    // Since there's no usage yet on Feb 18 (neither UTC nor EST), the graph is right.
    // HOWEVER: if usage happened between 7-11:59 PM EST on Feb 17,
    // it would show as Feb 18 UTC in the graph — making it look like
    // "the latest usage is 2/18" when it really happened on 2/17 EST.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Proxy timestamp storage
// ═══════════════════════════════════════════════════════════════════════════════

describe("Proxy timestamp storage", () => {
  it("SQLite datetime('now') stores UTC timestamps", () => {
    // The proxy uses: VALUES (datetime('now'), ...)
    // SQLite's datetime('now') always returns UTC
    // This is correct for storage, but means all downstream date grouping
    // must account for timezone conversion if displaying local dates

    // Simulate what SQLite datetime('now') would return
    const sqliteNow = new Date().toISOString().replace("T", " ").slice(0, 19);
    // Format: "2026-02-18 20:00:00" (UTC)
    expect(sqliteNow).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Chart date formatting
// ═══════════════════════════════════════════════════════════════════════════════

describe("Token usage chart — date display", () => {
  it("chart tickFormatter parses date string with `new Date(v)` which uses local TZ", () => {
    // In token-usage-chart.tsx line 37:
    //   tickFormatter={(v: string) => format(new Date(v), "MMM d")}
    //
    // When v = "2026-02-18" (from UTC grouping), new Date("2026-02-18")
    // creates a Date at midnight UTC. In EST (UTC-5), this displays as
    // Feb 17 at 7 PM — so format() would show "Feb 17" on the chart!
    //
    // This is ANOTHER source of off-by-one: the date string "2026-02-18"
    // from UTC grouping may display as "Feb 17" on an EST browser.

    // Simulate: new Date("2026-02-18") in different TZ contexts
    const utcDateStr = "2026-02-18";
    const parsed = new Date(utcDateStr);

    // In UTC: this is midnight Feb 18
    expect(parsed.toISOString()).toBe("2026-02-18T00:00:00.000Z");

    // In EST (UTC-5), getDate() would return 17 (Feb 17 at 7 PM)
    // We can't easily test TZ-dependent behavior in vitest without TZ env,
    // but we can verify the UTC interpretation
    expect(parsed.getUTCDate()).toBe(18);
    expect(parsed.getUTCMonth()).toBe(1); // 0-indexed, Feb = 1
  });

  it("date-only string parsed as UTC midnight may shift when displayed locally", () => {
    // new Date("2026-02-18") = 2026-02-18T00:00:00Z (UTC midnight)
    // In UTC-5 (EST): 2026-02-17T19:00:00-05:00
    // format(date, "MMM d") in EST browser would show "Feb 17"
    // This compounds the UTC grouping issue

    const dateStr = "2026-02-18";
    const d = new Date(dateStr);

    // UTC date is correct
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(18);

    // But local date depends on timezone — in EST this would be 17
    // We verify the raw UTC to document the behavior
    expect(d.getTime()).toBe(Date.UTC(2026, 1, 18, 0, 0, 0, 0));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. getCutoffDate period boundary tests with timezone implications
// ═══════════════════════════════════════════════════════════════════════════════

describe("getCutoffDate — period boundaries across timezone offsets", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("7d cutoff at start of day UTC vs start of day EST", () => {
    vi.useFakeTimers();

    // Midnight UTC on Feb 18
    vi.setSystemTime(new Date("2026-02-18T00:00:00Z"));
    const cutoffAtMidnightUTC = getCutoffDate("7d");
    expect(cutoffAtMidnightUTC.toISOString().slice(0, 10)).toBe("2026-02-11");

    // Midnight EST on Feb 18 = 5 AM UTC on Feb 18
    vi.setSystemTime(new Date("2026-02-18T05:00:00Z"));
    const cutoffAtMidnightEST = getCutoffDate("7d");
    expect(cutoffAtMidnightEST.toISOString().slice(0, 10)).toBe("2026-02-11");

    // Both have the same date portion, but different times
    // The EST cutoff is 5 hours later, potentially excluding more early-morning entries
  });

  it("30d cutoff may exclude/include boundary day depending on server TZ", () => {
    vi.useFakeTimers();

    // Late night EST (just before midnight) = early morning UTC
    // Jan 19 cutoff in UTC, but user might expect Jan 18 if thinking in EST
    vi.setSystemTime(new Date("2026-02-18T03:00:00Z")); // 10 PM EST on Feb 17
    const cutoff = getCutoffDate("30d");
    // 30 days before 2026-02-18T03:00:00Z = 2026-01-19T03:00:00Z
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-01-19");
  });

  it('"all" period is timezone-agnostic (year 2000)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T23:59:59Z"));
    const cutoff = getCutoffDate("all");
    expect(cutoff.getFullYear()).toBe(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. End-to-end analytics aggregation simulation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Analytics aggregation — simulated end-to-end", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("full pipeline: proxy stores UTC, API groups UTC, chart may shift date", () => {
    // Step 1: Proxy stores timestamp at 10 PM EST = 3 AM UTC next day
    const proxyTimestamp = new Date("2026-02-19T03:00:00Z"); // 10 PM EST on 2/18

    // Step 2: Analytics API groups by UTC date
    const apiDateKey = proxyTimestamp.toISOString().slice(0, 10);
    expect(apiDateKey).toBe("2026-02-19"); // Grouped under Feb 19

    // Step 3: Chart receives { date: "2026-02-19", totalInput: ..., totalOutput: ... }
    // Chart does: format(new Date("2026-02-19"), "MMM d")
    // In EST browser: new Date("2026-02-19") = Feb 18 at 7 PM EST
    // So format shows "Feb 18" — which is actually correct for the user!
    // But the data point itself is associated with the wrong logical day.

    // The net effect: two wrongs can make a right for EST users in DISPLAY,
    // but the DATA aggregation is still wrong — tokens from different EST days
    // get mixed together in UTC-date buckets.

    // Example: tokens from 8 PM EST on Feb 18 (= Feb 19 UTC) get combined with
    // tokens from 10 AM EST on Feb 19 (= Feb 19 UTC) in the same bucket
    const evening218EST = new Date("2026-02-19T01:00:00Z"); // 8 PM EST on 2/18
    const morning219EST = new Date("2026-02-19T15:00:00Z"); // 10 AM EST on 2/19

    const key1 = evening218EST.toISOString().slice(0, 10);
    const key2 = morning219EST.toISOString().slice(0, 10);

    // Both get grouped under the same UTC date
    expect(key1).toBe("2026-02-19");
    expect(key2).toBe("2026-02-19");
    // But they're from different EST days — the bar chart value for "Feb 19"
    // includes Feb 18 evening AND Feb 19 morning EST usage
  });

  it("demonstrates correct EST-based aggregation would show different totals", () => {
    const logs = [
      // Feb 17 EST evening (= Feb 18 UTC)
      { timestamp: new Date("2026-02-18T02:00:00Z"), tokens: 100 }, // 9 PM EST 2/17
      { timestamp: new Date("2026-02-18T04:30:00Z"), tokens: 200 }, // 11:30 PM EST 2/17
      // Feb 18 EST daytime (= Feb 18 UTC)
      { timestamp: new Date("2026-02-18T14:00:00Z"), tokens: 300 }, // 9 AM EST 2/18
      { timestamp: new Date("2026-02-18T20:00:00Z"), tokens: 400 }, // 3 PM EST 2/18
      // Feb 18 EST evening (= Feb 19 UTC)
      { timestamp: new Date("2026-02-19T01:00:00Z"), tokens: 500 }, // 8 PM EST 2/18
      { timestamp: new Date("2026-02-19T03:30:00Z"), tokens: 600 }, // 10:30 PM EST 2/18
    ];

    // UTC grouping
    const utcGroups = new Map<string, number>();
    for (const log of logs) {
      const key = log.timestamp.toISOString().slice(0, 10);
      utcGroups.set(key, (utcGroups.get(key) ?? 0) + log.tokens);
    }

    expect(utcGroups.get("2026-02-18")).toBe(100 + 200 + 300 + 400); // 1000
    expect(utcGroups.get("2026-02-19")).toBe(500 + 600); // 1100

    // EST grouping (UTC-5)
    const estGroups = new Map<string, number>();
    for (const log of logs) {
      const est = new Date(log.timestamp.getTime() - 5 * 60 * 60 * 1000);
      const key = est.toISOString().slice(0, 10);
      estGroups.set(key, (estGroups.get(key) ?? 0) + log.tokens);
    }

    expect(estGroups.get("2026-02-17")).toBe(100 + 200); // 300
    expect(estGroups.get("2026-02-18")).toBe(300 + 400 + 500 + 600); // 1800

    // The totals per day are DIFFERENT — this is the real data accuracy issue
    expect(utcGroups.get("2026-02-18")).not.toBe(estGroups.get("2026-02-18"));
  });
});
