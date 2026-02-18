import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import type { KnowledgeBaseEntry } from "@/types";
import fs from "fs";
import path from "path";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/knowledge-base/[id] — update an existing entry
export async function PATCH(
  req: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return err("Invalid id", "VALIDATION_ERROR");

    const existing = await db.indexedProject.findUnique({ where: { id } });
    if (!existing) return notFound("Knowledge base entry not found");

    const body = await req.json();
    const {
      path: inputPath,
      name,
      tags,
    } = body as {
      path?: string;
      name?: string;
      tags?: string[];
    };

    const updates: Record<string, unknown> = {};

    // Validate new path if provided
    if (inputPath !== undefined) {
      if (typeof inputPath !== "string" || !inputPath.trim()) {
        return err("path must be a non-empty string", "VALIDATION_ERROR");
      }
      const resolved = path.resolve(inputPath.trim());

      if (!fs.existsSync(resolved)) {
        return err(
          `Path does not exist: ${resolved}`,
          "PATH_NOT_FOUND"
        );
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return err("Path must be a directory", "NOT_A_DIRECTORY");
      }

      // Check for duplicates (allow keeping the same path)
      if (resolved !== existing.path) {
        const dup = await db.indexedProject.findUnique({
          where: { path: resolved },
        });
        if (dup) {
          return err(
            `Path already exists in knowledge base: ${resolved}`,
            "DUPLICATE_PATH",
            409
          );
        }
      }
      updates.path = resolved;
    }

    if (name !== undefined) {
      if (typeof name !== "string") {
        return err("name must be a string", "VALIDATION_ERROR");
      }
      updates.name = name.trim() || existing.name;
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return err("tags must be an array", "VALIDATION_ERROR");
      }
      updates.tags = JSON.stringify(tags);
    }

    if (Object.keys(updates).length === 0) {
      return err("No fields to update", "VALIDATION_ERROR");
    }

    const updated = await db.indexedProject.update({
      where: { id },
      data: updates,
    });

    const entry: KnowledgeBaseEntry = {
      id: updated.id,
      path: updated.path,
      name: updated.name,
      tags: JSON.parse(updated.tags) as string[],
      lastScanned: updated.lastScanned?.toISOString() ?? undefined,
      source: "db",
    };

    return ok(entry);
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/knowledge-base/[id] — remove a path from knowledge base
// For DB entries (id > 0): deletes the DB record
// For filesystem entries (id = -1): expects ?path= query param, adds to hidden list
export async function DELETE(
  req: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return err("Invalid id", "VALIDATION_ERROR");

    // Filesystem-only entry: hide by path
    if (id === -1) {
      const hidePath = req.nextUrl.searchParams.get("path");
      if (!hidePath) return err("path query param required for filesystem entries", "VALIDATION_ERROR");
      if (!hidePath.startsWith("/") || hidePath.length > 4096) {
        return err("path must be an absolute path (max 4096 chars)", "VALIDATION_ERROR");
      }

      const pref = await db.preference.findUnique({ where: { key: "kb_hidden_paths" } });
      let hidden: string[] = [];
      if (pref) {
        try { hidden = JSON.parse(pref.value) as string[]; } catch { /* reset */ }
      }

      if (hidden.length >= 500) {
        return err("Too many hidden paths (max 500)", "VALIDATION_ERROR");
      }
      if (!hidden.includes(hidePath)) {
        hidden.push(hidePath);
      }

      await db.preference.upsert({
        where: { key: "kb_hidden_paths" },
        create: { key: "kb_hidden_paths", value: JSON.stringify(hidden) },
        update: { value: JSON.stringify(hidden) },
      });

      return ok({ deleted: true });
    }

    // DB entry: delete the record
    const existing = await db.indexedProject.findUnique({ where: { id } });
    if (!existing) return notFound("Knowledge base entry not found");

    await db.indexedProject.delete({ where: { id } });

    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
