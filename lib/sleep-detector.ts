/**
 * Sleep/wake detection and recovery for persistent agent teams.
 *
 * Detects system sleep by comparing wall-clock time gaps between health
 * polls. If the gap exceeds a threshold, we assume the machine slept.
 * Teams marked as "persistent" are automatically woken after sleep.
 */

import fs from "fs";
import path from "path";
import type { BackgroundConfig } from "@/types";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

/** Default background config for new teams */
export const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  persistent: false,
  wakeStrategy: "immediate",
  wakeDelaySeconds: 0,
  maxWakeRetries: 3,
  wakeRetryCount: 0,
  lastSleepDetected: null,
  lastAutoWake: null,
};

// ── File-based heartbeat tracking ────────────────────────────────────────────

/**
 * Minimum gap (in ms) between polls that we consider a "sleep event".
 * Set to 2 minutes — normal polling is 3-30s, so a 2-min gap is a strong signal.
 */
const SLEEP_GAP_MS = 2 * 60 * 1000;

function lastPollPath(teamName: string): string {
  return path.join(CLAUDE_DIR, "teams", teamName, "last-poll.json");
}

function readLastPollTime(teamName: string): number | null {
  try {
    const raw = fs.readFileSync(lastPollPath(teamName), "utf-8");
    const parsed = JSON.parse(raw) as { lastPollTime?: number };
    return typeof parsed.lastPollTime === "number" ? parsed.lastPollTime : null;
  } catch {
    return null;
  }
}

function writeLastPollTime(teamName: string, time: number): void {
  try {
    const filePath = lastPollPath(teamName);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify({ lastPollTime: time }), "utf-8");
  } catch {
    // Non-critical — ignore write failures
  }
}

/**
 * Check if the system likely slept since the last health poll for this team.
 * Call this from the health endpoint on each poll.
 *
 * Returns true if a sleep was detected (first call after the gap).
 */
export function detectSleep(teamName: string): boolean {
  try {
    const now = Date.now();
    const lastPoll = readLastPollTime(teamName);
    writeLastPollTime(teamName, now);

    if (lastPoll === null) {
      // First poll — no sleep to detect
      return false;
    }

    const gap = now - lastPoll;
    return gap > SLEEP_GAP_MS;
  } catch {
    return false;
  }
}

// ── Background config persistence ────────────────────────────────────────────

function backgroundConfigPath(teamName: string): string {
  return path.join(CLAUDE_DIR, "teams", teamName, "background.json");
}

export function readBackgroundConfig(teamName: string): BackgroundConfig {
  const configPath = backgroundConfigPath(teamName);
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BackgroundConfig>;
    return { ...DEFAULT_BACKGROUND_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_BACKGROUND_CONFIG };
  }
}

export function writeBackgroundConfig(
  teamName: string,
  config: BackgroundConfig
): void {
  const configPath = backgroundConfigPath(teamName);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Record that a sleep event was detected for a team.
 * Increments the wake retry counter and updates timestamps.
 */
export function recordSleepEvent(teamName: string): BackgroundConfig {
  const config = readBackgroundConfig(teamName);
  config.lastSleepDetected = new Date().toISOString();
  config.wakeRetryCount += 1;
  writeBackgroundConfig(teamName, config);
  return config;
}

/**
 * Record that an auto-wake was performed.
 */
export function recordAutoWake(teamName: string): void {
  const config = readBackgroundConfig(teamName);
  config.lastAutoWake = new Date().toISOString();
  writeBackgroundConfig(teamName, config);
}

/**
 * Reset wake retry counter (e.g., after a successful manual wake or task completion).
 */
export function resetWakeRetries(teamName: string): void {
  const config = readBackgroundConfig(teamName);
  config.wakeRetryCount = 0;
  writeBackgroundConfig(teamName, config);
}

/**
 * Determine whether a team should be auto-woken after sleep.
 */
export function shouldAutoWake(teamName: string): {
  shouldWake: boolean;
  reason: string;
  config: BackgroundConfig;
} {
  const config = readBackgroundConfig(teamName);

  if (!config.persistent) {
    return { shouldWake: false, reason: "Team is not marked as persistent", config };
  }

  if (config.wakeRetryCount >= config.maxWakeRetries) {
    return {
      shouldWake: false,
      reason: `Max wake retries (${config.maxWakeRetries}) exceeded`,
      config,
    };
  }

  if (config.wakeStrategy === "scheduled" && config.wakeDelaySeconds > 0 && config.lastSleepDetected) {
    const sleepTime = new Date(config.lastSleepDetected).getTime();
    const waitUntil = sleepTime + config.wakeDelaySeconds * 1000;
    if (Date.now() < waitUntil) {
      const remainingSec = Math.ceil((waitUntil - Date.now()) / 1000);
      return {
        shouldWake: false,
        reason: `Scheduled wake in ${remainingSec}s`,
        config,
      };
    }
  }

  return { shouldWake: true, reason: "Auto-wake conditions met", config };
}
