import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import { spawnTeam } from "@/lib/team-spawner";
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

    // Link the spawned team back to the queued task
    if (plan.sourceTaskId != null) {
      await db.queuedTask.updateMany({
        where: { id: plan.sourceTaskId, status: "pending" },
        data: { teamName: result.teamName, status: "running", startedAt: new Date() },
      });
    }

    return ok({
      ...result,
      alreadyRunning: result.launched.length === 0 ? ["leader"] : [],
    });
  } catch (e) {
    // Surface the duplicate-team error from spawnTeam as a 409 instead of 500
    if (e instanceof Error && e.message.includes("already exists")) {
      return err(e.message, "DUPLICATE_TEAM", 409);
    }
    return serverError(e);
  }
}
