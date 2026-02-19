import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import Anthropic from "@anthropic-ai/sdk";

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string;
  rateLimitTier: string;
}

interface CredentialsFile {
  claudeAiOauth?: OAuthCredentials;
}

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

/** Read the raw OAuth credentials from ~/.claude/.credentials.json */
function readCredentials(): OAuthCredentials | null {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CredentialsFile;
    return parsed.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

/** Get OAuth status info for the settings UI (no token exposed) */
export function getOAuthStatus(): {
  configured: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: string | null;
  valid: boolean;
} {
  const creds = readCredentials();
  if (!creds) {
    return { configured: false, subscriptionType: null, rateLimitTier: null, expiresAt: null, valid: false };
  }
  const valid = creds.expiresAt > Date.now();
  return {
    configured: true,
    subscriptionType: creds.subscriptionType,
    rateLimitTier: creds.rateLimitTier,
    expiresAt: new Date(creds.expiresAt).toISOString(),
    valid,
  };
}

/** Create an Anthropic SDK client using OAuth Bearer auth */
export function createOAuthClient(): Anthropic | null {
  const creds = readCredentials();
  if (!creds || creds.expiresAt <= Date.now()) {
    return null;
  }
  return new Anthropic({
    apiKey: null,
    authToken: creds.accessToken,
    defaultHeaders: {
      "anthropic-beta": "oauth-2025-04-20",
    },
  });
}
