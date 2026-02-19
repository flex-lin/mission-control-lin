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

/**
 * Validate a URL string: must be http or https scheme.
 * Returns the validated URL or an error response.
 */
export function validateUrl(urlStr: string, fieldName = "url"): { valid: true; url: URL } | { valid: false; error: NextResponse } {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { valid: false, error: err(`${fieldName} must use http or https protocol`, "VALIDATION_ERROR") };
    }
    return { valid: true, url };
  } catch {
    return { valid: false, error: err(`${fieldName} is not a valid URL`, "VALIDATION_ERROR") };
  }
}
