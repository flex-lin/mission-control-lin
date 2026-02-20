import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import type { ApiResponse } from "@/types";

export function ok<T>(data: T, meta?: Record<string, unknown>): NextResponse {
  const body: ApiResponse<T> = { data };
  if (meta) body.meta = meta;
  return NextResponse.json(body, { status: 200 });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data } satisfies ApiResponse<T>, { status: 201 });
}

export function err(
  message: string,
  code: string,
  status = 400
): NextResponse {
  return NextResponse.json(
    { error: message, code } satisfies ApiResponse<never>,
    { status }
  );
}

export function notFound(message = "Not found"): NextResponse {
  return err(message, "NOT_FOUND", 404);
}

export function serverError(e: unknown): NextResponse {
  if (e instanceof Error) {
    console.error("[api] server error:", e.message);
  }
  return err("Internal server error", "SERVER_ERROR", 500);
}

// ── Shared Validation Utilities ──────────────────────────────────────────────

/**
 * Validate that a team/task name contains only safe characters.
 * Returns the sanitized name or null if invalid.
 */
export function safeName(name: string): string | null {
  if (!/^[\w-]+$/.test(name)) return null;
  return name;
}

/**
 * Validate a projectPath: must be absolute, exist on disk, and be a directory.
 * Returns the resolved path or an error response.
 */
export function validateProjectPath(projectPath: string): { valid: true; resolved: string } | { valid: false; error: NextResponse } {
  const trimmed = projectPath.trim();
  if (!trimmed) {
    return { valid: false, error: err("projectPath cannot be empty", "VALIDATION_ERROR") };
  }
  if (!path.isAbsolute(trimmed)) {
    return { valid: false, error: err("projectPath must be an absolute path", "VALIDATION_ERROR") };
  }
  // Resolve to canonical path (eliminates .. and symlinks for checking)
  const resolved = path.resolve(trimmed);
  // Block obvious dangerous paths
  if (resolved === "/" || resolved === "/root" || resolved === "/etc" || resolved.startsWith("/proc") || resolved.startsWith("/sys")) {
    return { valid: false, error: err("projectPath points to a restricted system directory", "VALIDATION_ERROR") };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { valid: false, error: err("projectPath must be an existing directory", "VALIDATION_ERROR") };
  }
  return { valid: true, resolved };
}

/** Private/reserved IPv4 ranges that should be blocked for SSRF prevention */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // link-local
  /^0\./, // current network
];

/** Hostnames and IPv6 patterns to block */
const BLOCKED_HOSTS = new Set(["localhost", "[::1]", "[0:0:0:0:0:0:0:1]"]);
const BLOCKED_IPV6_PREFIXES = ["fe80:", "fc00:", "fd00:", "::1"];

function isPrivateHost(hostname: string): boolean {
  // Check blocked hostnames
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;

  // Strip brackets from IPv6
  const bare = hostname.replace(/^\[|\]$/g, "");

  // Check IPv6 blocked prefixes
  const lower = bare.toLowerCase();
  if (BLOCKED_IPV6_PREFIXES.some((p) => lower.startsWith(p))) return true;

  // Check IPv4 private ranges
  if (PRIVATE_IP_PATTERNS.some((re) => re.test(bare))) return true;

  return false;
}

/**
 * Validate a URL string: must be http or https scheme.
 * By default blocks private/reserved IPs to prevent SSRF.
 * Pass `options.allowPrivate: true` for legitimate local targets (e.g. proxy).
 * Returns the validated URL or an error response.
 */
export function validateUrl(
  urlStr: string,
  fieldName = "url",
  options?: { allowPrivate?: boolean }
): { valid: true; url: URL } | { valid: false; error: NextResponse } {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { valid: false, error: err(`${fieldName} must use http or https protocol`, "VALIDATION_ERROR") };
    }
    if (!options?.allowPrivate && isPrivateHost(url.hostname)) {
      return { valid: false, error: err(`${fieldName} must not point to a private/reserved address`, "VALIDATION_ERROR") };
    }
    return { valid: true, url };
  } catch {
    return { valid: false, error: err(`${fieldName} is not a valid URL`, "VALIDATION_ERROR") };
  }
}
