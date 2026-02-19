import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, created, err, serverError } from "@/lib/api-helpers";
import type { KnowledgeBaseEntry } from "@/types";
import fs from "fs";
import path from "path";

// GET /api/knowledge-base — list all knowledge base paths
// Returns only DB IndexedProject records (manually added by the user).
// Filesystem projects from ~/.claude/projects/ are NOT auto-included so that
// a fresh clone starts with a blank knowledge base.
export async function GET(): Promise<NextResponse> {
  try {
    const dbRecords = await db.indexedProject.findMany({
      orderBy: { id: "desc" },
    });

    const entries: KnowledgeBaseEntry[] = dbRecords.map((rec) => ({
      id: rec.id,
      path: rec.path,
      name: rec.name,
      tags: JSON.parse(rec.tags) as string[],
      lastScanned: rec.lastScanned?.toISOString() ?? undefined,
      source: "db" as const,
    }));

    return ok(entries, { count: entries.length });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/knowledge-base — add a new path/folder
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { path: inputPath, name, tags } = body as {
      path?: string;
      name?: string;
      tags?: string[];
    };

    if (!inputPath || typeof inputPath !== "string") {
      return err("path is required", "VALIDATION_ERROR");
    }

    // Resolve and normalize the path
    const resolved = path.resolve(inputPath.trim());

    // Validate path exists on filesystem
    if (!fs.existsSync(resolved)) {
      return err(
        `Path does not exist: ${resolved}`,
        "PATH_NOT_FOUND"
      );
    }

    // Validate it's a directory
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return err("Path must be a directory", "NOT_A_DIRECTORY");
    }

    // Check for duplicates
    const existing = await db.indexedProject.findUnique({
      where: { path: resolved },
    });
    if (existing) {
      return err(
        `Path already exists in knowledge base: ${resolved}`,
        "DUPLICATE_PATH",
        409
      );
    }

    // Derive name from folder if not provided
    const derivedName =
      name?.trim() || path.basename(resolved) || resolved;

    const item = await db.indexedProject.create({
      data: {
        path: resolved,
        name: derivedName,
        tags: JSON.stringify(tags ?? []),
      },
    });

    const entry: KnowledgeBaseEntry = {
      id: item.id,
      path: item.path,
      name: item.name,
      tags: JSON.parse(item.tags) as string[],
      lastScanned: item.lastScanned?.toISOString() ?? undefined,
      source: "db",
    };

    return created(entry);
  } catch (e) {
    return serverError(e);
  }
}
