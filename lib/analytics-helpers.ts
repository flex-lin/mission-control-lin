/**
 * Compute the cutoff date for analytics queries based on a period string.
 * @param period - "7d", "30d", "1m", or "all"
 */
export function getCutoffDate(period: string): Date {
  const now = new Date();
  const cutoff = new Date(now);
  if (period === "all") cutoff.setFullYear(2000);
  else if (period === "30d") cutoff.setDate(now.getDate() - 30);
  else if (period === "1m") cutoff.setMonth(now.getMonth() - 1);
  else cutoff.setDate(now.getDate() - 7);
  return cutoff;
}

/** Label for null team names — use consistently across all routes */
export const UNTRACKED_TEAM_LABEL = "untracked";
