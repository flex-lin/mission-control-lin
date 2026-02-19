import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/projects — list projects from the DB only (IndexedProject records).
// Filesystem projects from ~/.claude/projects/ are NOT auto-included so that
// a fresh clone starts with a blank knowledge base.
export async function GET(): Promise<NextResponse> {
  try {
    const indexed = await db.indexedProject.findMany({
      orderBy: { id: "desc" },
    });

    const data = indexed.map((p) => ({
      id: p.id.toString(),
      path: p.path,
      name: p.name,
      tags: JSON.parse(p.tags) as string[],
      lastScanned: p.lastScanned?.toISOString() ?? undefined,
    }));

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
