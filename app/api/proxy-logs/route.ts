import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, err, created, serverError } from "@/lib/api-helpers";

// GET /api/proxy-logs?limit=50&offset=0&model=&team=&status=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 500);
    const offset = Number(searchParams.get("offset") ?? 0);
    const modelFilter = searchParams.get("model");
    const teamFilter = searchParams.get("team");
    const statusFilter = searchParams.get("status");

    const repoFilter = searchParams.get("repo");

    const where: {
      model?: string;
      teamName?: string | null;
      repoName?: string | null;
      statusCode?: number;
    } = {};

    if (modelFilter) where.model = modelFilter;
    if (teamFilter) where.teamName = teamFilter;
    if (repoFilter) where.repoName = repoFilter;
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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      teamName?: string;
      memberName?: string;
      repoName?: string;
      endpoint?: string;
      latencyMs?: number;
      statusCode?: number;
    };

    if (!body.model || typeof body.model !== "string") {
      return err("model is required", "MISSING_FIELDS");
    }

    const log = await db.proxyLog.create({
      data: {
        model: body.model,
        inputTokens: body.inputTokens ?? 0,
        outputTokens: body.outputTokens ?? 0,
        cacheReadTokens: body.cacheReadTokens ?? 0,
        cacheCreationTokens: body.cacheCreationTokens ?? 0,
        teamName: body.teamName ?? null,
        memberName: body.memberName ?? null,
        repoName: body.repoName ?? null,
        endpoint: body.endpoint ?? "/v1/messages",
        latencyMs: body.latencyMs ?? 0,
        statusCode: body.statusCode ?? 200,
      },
    });

    return created(log);
  } catch (e) {
    return serverError(e);
  }
}
