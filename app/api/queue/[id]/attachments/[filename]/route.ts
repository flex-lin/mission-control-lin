import { NextRequest, NextResponse } from "next/server";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import type { TaskAttachment } from "@/types";
import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "tasks");

type RouteContext = { params: Promise<{ id: string; filename: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id, filename } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Task not found");

    const attachments: TaskAttachment[] = JSON.parse(task.attachments || "[]");
    const attachment = attachments.find((a) => a.filename === filename);
    if (!attachment) return notFound("Attachment not found");

    const filePath = path.join(UPLOAD_DIR, String(taskId), filename);

    // Prevent path traversal
    if (!filePath.startsWith(path.join(UPLOAD_DIR, String(taskId)))) {
      return err("Invalid filename", "VALIDATION_ERROR");
    }

    if (!existsSync(filePath)) return notFound("File not found on disk");

    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `inline; filename="${attachment.originalName}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id, filename } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Task not found");

    const attachments: TaskAttachment[] = JSON.parse(task.attachments || "[]");
    const attachment = attachments.find((a) => a.filename === filename);
    if (!attachment) return notFound("Attachment not found");

    const filePath = path.join(UPLOAD_DIR, String(taskId), filename);

    // Prevent path traversal
    if (!filePath.startsWith(path.join(UPLOAD_DIR, String(taskId)))) {
      return err("Invalid filename", "VALIDATION_ERROR");
    }

    // Remove from disk
    if (existsSync(filePath)) {
      await unlink(filePath);
    }

    // Update DB
    const remaining = attachments.filter((a) => a.filename !== filename);
    await db.queuedTask.update({
      where: { id: taskId },
      data: { attachments: JSON.stringify(remaining) },
    });

    return ok({ deleted: true, remaining: remaining.length });
  } catch (e) {
    return serverError(e);
  }
}
