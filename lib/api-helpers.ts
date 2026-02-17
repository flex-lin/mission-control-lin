import { NextResponse } from "next/server";
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
    { error: message, code } satisfies { error: string; code: string },
    { status }
  );
}

export function notFound(message = "Not found"): NextResponse {
  return err(message, "NOT_FOUND", 404);
}

export function serverError(e: unknown): NextResponse {
  const message =
    e instanceof Error ? e.message : "Internal server error";
  return err(message, "SERVER_ERROR", 500);
}
