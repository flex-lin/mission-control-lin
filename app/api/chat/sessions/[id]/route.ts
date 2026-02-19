import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, notFound, serverError } from "@/lib/api-helpers";

// GET /api/chat/sessions/[id] — get session with all messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const session = await db.chatSession.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) return notFound("Session not found");

    return ok({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        toolResults: m.toolResults ? JSON.parse(m.toolResults) : undefined,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

// PATCH /api/chat/sessions/[id] — rename session
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { title?: string };

    const session = await db.chatSession.update({
      where: { id },
      data: { title: body.title ?? null },
    });

    return ok({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Record to update not found")) {
      return notFound("Session not found");
    }
    return serverError(e);
  }
}

// DELETE /api/chat/sessions/[id] — delete session and all messages
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.chatSession.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Record to delete does not exist")) {
      return notFound("Session not found");
    }
    return serverError(e);
  }
}
