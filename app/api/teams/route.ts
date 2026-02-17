import { NextRequest, NextResponse } from "next/server";
import { listTeams } from "@/lib/claude-files";
import { ok, err, serverError } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// GET /api/teams — list all teams from ~/.claude/teams/
export async function GET(): Promise<NextResponse> {
  try {
    const teams = listTeams().map((t) => ({
      ...t,
      members: t.members ?? [],
    }));
    return ok(teams, { count: teams.length });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/teams — create a new team config
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { name?: string; description?: string };

    if (!body.name || typeof body.name !== "string") {
      return err("name is required", "VALIDATION_ERROR");
    }

    // Validate name: only alphanumeric, dash, underscore
    if (!/^[\w-]+$/.test(body.name)) {
      return err("name may only contain letters, numbers, dashes, and underscores", "VALIDATION_ERROR");
    }

    const teamDir = path.join(CLAUDE_DIR, "teams", body.name);
    const resolvedDir = path.resolve(teamDir);
    if (!resolvedDir.startsWith(path.resolve(CLAUDE_DIR))) {
      return err("Path traversal blocked", "SECURITY_ERROR", 403);
    }

    if (fs.existsSync(path.join(teamDir, "config.json"))) {
      return err(`Team "${body.name}" already exists`, "CONFLICT", 409);
    }

    const config = {
      name: body.name,
      description: body.description ?? "",
      members: [],
      createdAt: new Date().toISOString(),
    };

    fs.mkdirSync(teamDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamDir, "config.json"),
      JSON.stringify(config, null, 2),
      "utf-8"
    );

    return NextResponse.json({ data: config }, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
