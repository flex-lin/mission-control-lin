import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCutoffDate, UNTRACKED_TEAM_LABEL } from "@/lib/analytics-helpers";

describe("getCutoffDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 7 days ago for default/unknown period", () => {
    const cutoff = getCutoffDate("7d");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-11");
  });

  it("returns 7 days ago for unrecognized period", () => {
    const cutoff = getCutoffDate("garbage");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-02-11");
  });

  it('returns 30 days ago for "30d"', () => {
    const cutoff = getCutoffDate("30d");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-01-19");
  });

  it('returns 1 month ago for "1m"', () => {
    const cutoff = getCutoffDate("1m");
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-01-18");
  });

  it('returns year 2000 for "all"', () => {
    const cutoff = getCutoffDate("all");
    expect(cutoff.getFullYear()).toBe(2000);
  });
});

describe("UNTRACKED_TEAM_LABEL", () => {
  it('is "untracked"', () => {
    expect(UNTRACKED_TEAM_LABEL).toBe("untracked");
  });
});
