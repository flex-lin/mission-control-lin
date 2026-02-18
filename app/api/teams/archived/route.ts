import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";
import type { Team } from "@/types";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function safeName(name: string): string {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

// GET /api/teams/archived — list archived teams
export async function GET(): Promise<NextResponse> {
  try {
    const archiveDir = path.join(CLAUDE_DIR, "teams-archive");
    if (!fs.existsSync(archiveDir)) return ok([], { count: 0 });

    const entries = fs.readdirSync(archiveDir, { withFileTypes: true });
    const teams: (Team & { archivedAt?: string })[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const configPath = path.join(archiveDir, entry.name, "config.json");
        if (!fs.existsSync(configPath)) continue;
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        teams.push({
          name: config.name ?? entry.name,
          members: config.members ?? [],
          description: config.description,
          createdAt: config.createdAt,
          archivedAt: config.archivedAt,
        });
      } catch {
        // skip malformed
      }
    }

    return ok(teams, { count: teams.length });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/teams/archived — restore an archived team
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { name?: string };
    if (!body.name || typeof body.name !== "string") {
      return err("name is required", "VALIDATION_ERROR");
    }

    const safe = safeName(body.name);
    const archiveTeamDir = path.join(CLAUDE_DIR, "teams-archive", safe);
    const archiveTasksDir = path.join(CLAUDE_DIR, "tasks-archive", safe);
    const teamDir = path.join(CLAUDE_DIR, "teams", safe);
    const tasksDir = path.join(CLAUDE_DIR, "tasks", safe);

    if (!fs.existsSync(archiveTeamDir)) {
      return err(`Archived team "${safe}" not found`, "NOT_FOUND", 404);
    }

    if (fs.existsSync(path.join(teamDir, "config.json"))) {
      return err(`Active team "${safe}" already exists`, "CONFLICT", 409);
    }

    // Remove archivedAt from config
    const configPath = path.join(archiveTeamDir, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    delete config.archivedAt;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    // Move back
    fs.mkdirSync(path.dirname(teamDir), { recursive: true });
    fs.renameSync(archiveTeamDir, teamDir);

    if (fs.existsSync(archiveTasksDir)) {
      fs.mkdirSync(path.dirname(tasksDir), { recursive: true });
      fs.renameSync(archiveTasksDir, tasksDir);
    }

    return ok({ name: safe, action: "restored" });
  } catch (e) {
    return serverError(e);
  }
}
