import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import { generateTeamPlan } from "@/lib/team-planner";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { goal?: string; projectPath?: string };
    if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
      return err("goal is required", "VALIDATION_ERROR");
    }

    const result = await generateTeamPlan(body.goal.trim(), body.projectPath?.trim());
    return ok(result);
  } catch (e) {
    return serverError(e);
  }
}
