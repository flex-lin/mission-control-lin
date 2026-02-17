import { NextResponse } from "next/server";
import { listProjects } from "@/lib/claude-files";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/projects — list projects from ~/.claude/projects/
// Merges file system data with indexed_projects table metadata
export async function GET(): Promise<NextResponse> {
  try {
    const fsProjects = listProjects();

    // Fetch DB metadata for enrichment
    const indexed = await db.indexedProject.findMany();
    const byPath = new Map(indexed.map((p) => [p.path, p]));

    const data = fsProjects.map((p) => {
      const meta = byPath.get(p.path);
      return {
        ...p,
        lastScanned: meta?.lastScanned?.toISOString(),
        tags: meta?.tags ? (JSON.parse(meta.tags) as string[]) : [],
      };
    });

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
