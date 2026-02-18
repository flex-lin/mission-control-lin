import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCutoffDate, UNTRACKED_TEAM_LABEL } from "../lib/analytics-helpers";

describe("getCutoffDate", () => {
  beforeEach(() => {
    // Fix time to 2026-02-18T12:00:00Z for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 7-day cutoff by default", () => {
    const cutoff = getCutoffDate("7d");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-11");
  });

  it("returns 7-day cutoff for unknown period strings", () => {
    const cutoff = getCutoffDate("unknown");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-11");
  });

  it("returns 30-day cutoff for '30d'", () => {
    const cutoff = getCutoffDate("30d");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-01-19");
  });

  it("returns 1-month cutoff for '1m'", () => {
    const cutoff = getCutoffDate("1m");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-01-18");
  });

  it("returns year-2000 cutoff for 'all'", () => {
    const cutoff = getCutoffDate("all");
    expect(cutoff.getFullYear()).toBe(2000);
  });

  it("returns a Date object", () => {
    expect(getCutoffDate("7d")).toBeInstanceOf(Date);
  });
});

describe("UNTRACKED_TEAM_LABEL", () => {
  it("is a non-empty string", () => {
    expect(typeof UNTRACKED_TEAM_LABEL).toBe("string");
    expect(UNTRACKED_TEAM_LABEL.length).toBeGreaterThan(0);
  });

  it("equals 'untracked'", () => {
    expect(UNTRACKED_TEAM_LABEL).toBe("untracked");
  });
});
