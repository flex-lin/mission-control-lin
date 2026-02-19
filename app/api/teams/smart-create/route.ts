import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError, validateProjectPath } from "@/lib/api-helpers";
import { generateTeamPlan } from "@/lib/team-planner";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { goal?: string; projectPath?: string };
    if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
      return err("goal is required", "VALIDATION_ERROR");
    }

    let projectPath: string | undefined;
    if (body.projectPath && typeof body.projectPath === "string" && body.projectPath.trim()) {
      const pathCheck = validateProjectPath(body.projectPath);
      if (!pathCheck.valid) return pathCheck.error;
      projectPath = pathCheck.resolved;
    }

    const result = await generateTeamPlan(body.goal.trim(), projectPath);
    return ok(result);
  } catch (e) {
    return serverError(e);
  }
}
