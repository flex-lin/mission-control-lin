import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ok, err, serverError } from "@/lib/api-helpers";
import type { TeamPlan } from "@/types";

const SYSTEM_PROMPT = `You are an expert at designing Claude Code agent teams. Given a goal, output a JSON TeamPlan with:
- teamName: a short kebab-case name for the team (alphanumeric and dashes only)
- description: a one-sentence description of what the team does
- personas: an array of team members, each with:
  - name: kebab-case agent name (e.g. "frontend-dev", "backend-dev")
  - role: a short role title (e.g. "Frontend Developer")
  - agentType: one of "general-purpose", "Bash", "Explore", "Plan"
  - description: what this agent is responsible for
- initialTasks: an array of tasks to bootstrap the team, each with:
  - subject: imperative task title (e.g. "Set up project scaffold")
  - description: detailed description of what needs to be done
  - assignTo: (optional) name of the persona to assign this task to

Output ONLY valid JSON, no markdown fences or extra text. Design practical teams of 2-5 members with clear role separation.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return err(
        "ANTHROPIC_API_KEY is not configured. Add it to your .env.local file.",
        "CONFIG_ERROR",
        500
      );
    }

    const body = (await req.json()) as { goal?: string; projectPath?: string };
    if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
      return err("goal is required", "VALIDATION_ERROR");
    }

    const client = new Anthropic({ apiKey });

    const userPrompt = body.projectPath
      ? `Goal: ${body.goal}\nProject path: ${body.projectPath}`
      : `Goal: ${body.goal}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return err("No text response from AI", "AI_ERROR", 500);
    }

    const plan = JSON.parse(textBlock.text) as TeamPlan;

    // Validate required fields
    if (!plan.teamName || !plan.personas || !Array.isArray(plan.personas) || plan.personas.length === 0) {
      return err("AI returned an invalid plan — missing teamName or personas", "AI_ERROR", 500);
    }

    if (!plan.initialTasks || !Array.isArray(plan.initialTasks)) {
      plan.initialTasks = [];
    }

    return ok(plan);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return err("AI returned invalid JSON — please try again", "AI_ERROR", 500);
    }
    return serverError(e);
  }
}
