import { NextResponse } from "next/server";
import { getOAuthStatus } from "@/lib/claude-oauth";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/settings/oauth — return OAuth connection status
export async function GET(): Promise<NextResponse> {
  try {
    const status = getOAuthStatus();
    return ok(status);
  } catch (e) {
    return serverError(e);
  }
}
