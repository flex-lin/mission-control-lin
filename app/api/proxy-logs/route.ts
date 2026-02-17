import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/proxy-logs?limit=50&offset=0&model=&team=&status=
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);
    const modelFilter = searchParams.get("model");
    const teamFilter = searchParams.get("team");
    const statusFilter = searchParams.get("status");

    const where: {
      model?: string;
      teamName?: string | null;
      statusCode?: number;
    } = {};

    if (modelFilter) where.model = modelFilter;
    if (teamFilter) where.teamName = teamFilter;
    if (statusFilter) where.statusCode = Number(statusFilter);

    const [logs, total] = await Promise.all([
      db.proxyLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: limit,
        skip: offset,
      }),
      db.proxyLog.count({ where }),
    ]);

    return ok(logs, { count: total, limit, offset });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/proxy-logs — log a new proxy request (called by proxy server)
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      teamName?: string;
      endpoint?: string;
      latencyMs?: number;
      statusCode?: number;
    };

    if (!body.model || typeof body.model !== "string") {
      return NextResponse.json({ error: "model is required" }, { status: 400 });
    }

    const log = await db.proxyLog.create({
      data: {
        model: body.model,
        inputTokens: body.inputTokens ?? 0,
        outputTokens: body.outputTokens ?? 0,
        teamName: body.teamName ?? null,
        endpoint: body.endpoint ?? "/v1/messages",
        latencyMs: body.latencyMs ?? 0,
        statusCode: body.statusCode ?? 200,
      },
    });

    return NextResponse.json({ data: log }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
