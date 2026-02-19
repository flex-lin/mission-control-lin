/**
 * GET    /api/compilation-errors/[id]  — get single error with attempts
 * PATCH  /api/compilation-errors/[id]  — update status or fields
 * DELETE /api/compilation-errors/[id]  — remove error record
 */
import { NextRequest, NextResponse } from "next/server";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";

const VALID_STATUSES = ["pending", "healing", "healed", "failed", "skipped"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return err("Invalid id", "VALIDATION_ERROR");

    const record = await db.compilationError.findUnique({
      where: { id: numId },
      include: {
        healingAttempts: { orderBy: { attemptNumber: "asc" } },
      },
    });

    if (!record) return notFound(`CompilationError #${id} not found`);
    return ok(record);
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return err("Invalid id", "VALIDATION_ERROR");

    const existing = await db.compilationError.findUnique({ where: { id: numId } });
    if (!existing) return notFound(`CompilationError #${id} not found`);

    const body = (await req.json()) as {
      status?: string;
      resolution?: string;
      maxRetries?: number;
    };

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return err(`status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR");
    }
    if (body.maxRetries !== undefined && (typeof body.maxRetries !== "number" || body.maxRetries < 1)) {
      return err("maxRetries must be a positive integer", "VALIDATION_ERROR");
    }

    const updated = await db.compilationError.update({
      where: { id: numId },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
        ...(body.maxRetries !== undefined ? { maxRetries: body.maxRetries } : {}),
      },
      include: { healingAttempts: { orderBy: { attemptNumber: "asc" } } },
    });

    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return err("Invalid id", "VALIDATION_ERROR");

    const existing = await db.compilationError.findUnique({ where: { id: numId } });
    if (!existing) return notFound(`CompilationError #${id} not found`);

    await db.compilationError.delete({ where: { id: numId } });
    return ok({ id: numId, deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
