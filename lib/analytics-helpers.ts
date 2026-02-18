/**
 * Compute the cutoff date for analytics queries based on a period string.
 * @param period - "7d", "30d", "1m", or "all"
 */
export function getCutoffDate(period: string): Date {
  const now = new Date();
  const cutoff = new Date(now);
  if (period === "all") cutoff.setUTCFullYear(2000);
  else if (period === "30d") cutoff.setUTCDate(now.getUTCDate() - 30);
  else if (period === "1m") cutoff.setUTCMonth(now.getUTCMonth() - 1);
  else cutoff.setUTCDate(now.getUTCDate() - 7);
  return cutoff;
}

/** Format a Date as YYYY-MM-DD in local timezone (not UTC) */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Label for null team names — use consistently across all routes */
export const UNTRACKED_TEAM_LABEL = "untracked";
