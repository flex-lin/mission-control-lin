import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import { spawnTeam, DuplicateTeamError } from "@/lib/team-spawner";
import { findTeamBySourceTaskId } from "@/lib/claude-files";
import { db } from "@/lib/db";
import type { TeamPlan } from "@/types";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { plan?: TeamPlan; projectPath?: string; persistent?: boolean };
    const plan = body.plan;
    const projectPath = body.projectPath?.trim() || undefined;

    if (!plan || !plan.teamName || !plan.personas || !Array.isArray(plan.personas)) {
      return err("Invalid plan: teamName and personas are required", "VALIDATION_ERROR");
    }

    // One-team-per-task guard: if sourceTaskId is provided, ensure no other
    // active team is already running for that queued task.
    if (plan.sourceTaskId != null) {
      // Check 1: DB-level — is the queued task already marked as running?
      const existing = await db.queuedTask.findFirst({
        where: {
          id: plan.sourceTaskId,
          status: { in: ["running"] },
          teamName: { not: null },
        },
      });
      if (existing) {
        return err(
          `Task #${plan.sourceTaskId} already has an active team: "${existing.teamName}"`,
          "DUPLICATE_TEAM",
          409
        );
      }

      // Check 2: File-level — does a team config with this sourceTaskId already exist?
      const existingTeamName = findTeamBySourceTaskId(plan.sourceTaskId);
      if (existingTeamName) {
        return err(
          `Task #${plan.sourceTaskId} already has a team on disk: "${existingTeamName}"`,
          "DUPLICATE_TEAM",
          409
        );
      }
    }

    const result = await spawnTeam(plan, projectPath, {
      persistent: body.persistent,
    });

    // Link the spawned team back to the queued task (optimistic lock via status: "pending")
    if (plan.sourceTaskId != null) {
      const updated = await db.queuedTask.updateMany({
        where: { id: plan.sourceTaskId, status: "pending" },
        data: { teamName: result.teamName, status: "running", startedAt: new Date() },
      });
      if (updated.count === 0) {
        // Another request already claimed this task — log but don't fail
        // (team was already spawned, so it will proceed regardless)
        console.warn(`[spawn] Task #${plan.sourceTaskId} was already claimed by another request`);
      }
    }

    return ok({
      ...result,
      alreadyRunning: result.launched.length === 0 ? ["leader"] : [],
    });
  } catch (e) {
    if (e instanceof DuplicateTeamError) {
      return err(e.message, "DUPLICATE_TEAM", 409);
    }
    return serverError(e);
  }
}
