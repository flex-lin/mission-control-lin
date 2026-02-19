import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, created, err, serverError } from "@/lib/api-helpers";

// GET /api/chat/sessions — list all sessions (newest first)
export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);

    const sessions = await db.chatSession.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 100),
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return ok(
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        messageCount: s._count.messages,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }))
    );
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/chat/sessions — create a new session
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { title?: string };

    const session = await db.chatSession.create({
      data: { title: body.title ?? null },
    });

    return created({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    });
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/chat/sessions — clear all sessions
export async function DELETE() {
  try {
    const { count } = await db.chatSession.deleteMany();
    return ok({ deleted: count });
  } catch (e) {
    return serverError(e);
  }
}
