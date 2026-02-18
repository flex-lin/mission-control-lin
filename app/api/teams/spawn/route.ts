import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import { spawnTeam } from "@/lib/team-spawner";
import type { TeamPlan } from "@/types";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { plan?: TeamPlan; projectPath?: string };
    const plan = body.plan;
    const projectPath = body.projectPath?.trim() || undefined;

    if (!plan || !plan.teamName || !plan.personas || !Array.isArray(plan.personas)) {
      return err("Invalid plan: teamName and personas are required", "VALIDATION_ERROR");
    }

    const result = await spawnTeam(plan, projectPath);

    return ok({
      ...result,
      alreadyRunning: result.launched.length === 0 ? ["leader"] : [],
    });
  } catch (e) {
    return serverError(e);
  }
}
