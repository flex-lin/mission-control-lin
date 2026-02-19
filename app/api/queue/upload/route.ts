import { NextRequest } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_TASK,
  type TaskAttachment,
} from "@/types";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "tasks");

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export async function POST(req: NextRequest) {
  try {
    const taskIdParam = new URL(req.url).searchParams.get("taskId");
    if (!taskIdParam) return err("taskId query param is required", "VALIDATION_ERROR");

    const taskId = parseInt(taskIdParam, 10);
    if (isNaN(taskId)) return err("Invalid taskId", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return err("Task not found", "NOT_FOUND", 404);

    const formData = await req.formData();
    const files = formData.getAll("files");

    if (files.length === 0) return err("No files provided", "VALIDATION_ERROR");

    // Parse existing attachments
    const existing: TaskAttachment[] = JSON.parse(task.attachments || "[]");

    if (existing.length + files.length > MAX_FILES_PER_TASK) {
      return err(
        `Max ${MAX_FILES_PER_TASK} files per task (currently ${existing.length})`,
        "VALIDATION_ERROR"
      );
    }

    const taskDir = path.join(UPLOAD_DIR, String(taskId));
    await mkdir(taskDir, { recursive: true });

    const newAttachments: TaskAttachment[] = [];

    for (const file of files) {
      if (!(file instanceof File)) {
        return err("Invalid file in form data", "VALIDATION_ERROR");
      }

      if (!ALLOWED_UPLOAD_TYPES.includes(file.type as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
        return err(
          `File type "${file.type}" not allowed. Accepted: ${ALLOWED_UPLOAD_TYPES.join(", ")}`,
          "VALIDATION_ERROR"
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return err(`File "${file.name}" exceeds 10MB limit`, "VALIDATION_ERROR");
      }

      const timestamp = Date.now();
      const sanitized = sanitizeFilename(file.name);
      const filename = `${timestamp}-${sanitized}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(taskDir, filename), buffer);

      newAttachments.push({
        filename,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
      });
    }

    const allAttachments = [...existing, ...newAttachments];

    const updated = await db.queuedTask.update({
      where: { id: taskId },
      data: { attachments: JSON.stringify(allAttachments) },
    });

    return ok({
      ...updated,
      attachments: allAttachments,
    });
  } catch (e) {
    return serverError(e);
  }
}
