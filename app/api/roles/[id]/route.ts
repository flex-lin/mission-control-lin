import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError, err, notFound } from "@/lib/api-helpers";
import type { AgentType } from "@/types";

const VALID_AGENT_TYPES: AgentType[] = ["general-purpose", "Bash", "Explore", "Plan"];

// GET /api/roles/[id] — get a single role by numeric ID
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
      return err("Invalid role ID", "VALIDATION_ERROR");
    }

    const role = await db.teamMemberRole.findUnique({ where: { id: numericId } });
    if (!role) {
      return notFound(`Role with ID ${numericId} not found`);
    }

    return ok(role);
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/roles/[id] — update a custom role (presets cannot be edited)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
      return err("Invalid role ID", "VALIDATION_ERROR");
    }

    const existing = await db.teamMemberRole.findUnique({ where: { id: numericId } });
    if (!existing) {
      return notFound(`Role with ID ${numericId} not found`);
    }
    if (existing.isPreset) {
      return err("Preset roles cannot be edited", "FORBIDDEN", 403);
    }

    const body = await req.json() as {
      name?: string;
      role?: string;
      agentType?: string;
      description?: string;
    };

    if (body.agentType !== undefined && !VALID_AGENT_TYPES.includes(body.agentType as AgentType)) {
      return err(`agentType must be one of: ${VALID_AGENT_TYPES.join(", ")}`, "VALIDATION_ERROR");
    }

    // Check name uniqueness if changing name
    if (body.name && body.name.trim() !== existing.name) {
      const conflict = await db.teamMemberRole.findUnique({ where: { name: body.name.trim() } });
      if (conflict) {
        return err(`A role with name "${body.name.trim()}" already exists`, "CONFLICT", 409);
      }
    }

    const updated = await db.teamMemberRole.update({
      where: { id: numericId },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.role !== undefined && { role: body.role.trim() }),
        ...(body.agentType !== undefined && { agentType: body.agentType.trim() }),
        ...(body.description !== undefined && { description: body.description.trim() }),
      },
    });

    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/roles/[id] — delete a custom role (presets cannot be deleted)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
      return err("Invalid role ID", "VALIDATION_ERROR");
    }

    const existing = await db.teamMemberRole.findUnique({ where: { id: numericId } });
    if (!existing) {
      return notFound(`Role with ID ${numericId} not found`);
    }
    if (existing.isPreset) {
      return err("Preset roles cannot be deleted", "FORBIDDEN", 403);
    }

    await db.teamMemberRole.delete({ where: { id: numericId } });

    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
