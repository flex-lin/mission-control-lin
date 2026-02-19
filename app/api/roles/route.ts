import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, created, serverError, err } from "@/lib/api-helpers";
import type { AgentType } from "@/types";

const PRESET_ROLES = [
  {
    name: "architect",
    role: "System Architect",
    agentType: "general-purpose",
    description: "Designs system architecture, defines data models, API contracts, and project structure. Owns technical decisions and scaffolding.",
    isPreset: true,
  },
  {
    name: "frontend-dev",
    role: "Frontend Developer",
    agentType: "general-purpose",
    description: "Implements pages, components, and client-side state management. Focuses on UI/UX and React components.",
    isPreset: true,
  },
  {
    name: "backend-dev",
    role: "Backend Developer",
    agentType: "general-purpose",
    description: "Implements API routes, database models, and business logic. Owns server-side code and integrations.",
    isPreset: true,
  },
  {
    name: "tester",
    role: "QA Engineer",
    agentType: "general-purpose",
    description: "Creates comprehensive tests covering the full application stack. Ensures quality through unit, integration, and e2e tests.",
    isPreset: true,
  },
  {
    name: "reviewer",
    role: "Code Reviewer",
    agentType: "general-purpose",
    description: "Reviews code across all files for quality, correctness, and adherence to conventions. Read-only advisory role.",
    isPreset: true,
  },
  {
    name: "devops",
    role: "DevOps Engineer",
    agentType: "Bash",
    description: "Manages CI/CD pipelines, infrastructure as code, containerization, and deployment automation.",
    isPreset: true,
  },
  {
    name: "data-engineer",
    role: "Data Engineer",
    agentType: "general-purpose",
    description: "Designs and implements data pipelines, ETL processes, and analytics infrastructure.",
    isPreset: true,
  },
  {
    name: "security",
    role: "Security Engineer",
    agentType: "Explore",
    description: "Audits code for vulnerabilities, implements authentication/authorization, and ensures security best practices.",
    isPreset: true,
  },
  {
    name: "tech-writer",
    role: "Technical Writer",
    agentType: "general-purpose",
    description: "Creates and maintains documentation, API references, README files, and user guides.",
    isPreset: true,
  },
  {
    name: "ml-engineer",
    role: "ML Engineer",
    agentType: "general-purpose",
    description: "Implements machine learning models, training pipelines, and model serving infrastructure.",
    isPreset: true,
  },
] as const;

async function ensurePresetsSeeded(): Promise<void> {
  const existingPresets = await db.teamMemberRole.findFirst({ where: { isPreset: true } });
  if (existingPresets) return;

  // Seed all presets
  for (const preset of PRESET_ROLES) {
    await db.teamMemberRole.upsert({
      where: { name: preset.name },
      update: {},
      create: preset,
    });
  }
}

// GET /api/roles — list all roles (presets + custom)
// Optional query: ?preset=true|false to filter by preset status
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await ensurePresetsSeeded();

    const { searchParams } = new URL(req.url);
    const presetFilter = searchParams.get("preset");

    const where: { isPreset?: boolean } = {};
    if (presetFilter === "true") where.isPreset = true;
    else if (presetFilter === "false") where.isPreset = false;

    const roles = await db.teamMemberRole.findMany({
      where,
      orderBy: [{ isPreset: "desc" }, { createdAt: "asc" }],
    });
    return ok(roles);
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/roles — create a custom role
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      name?: string;
      role?: string;
      agentType?: string;
      description?: string;
    };

    if (!body.name?.trim()) {
      return err("name is required", "VALIDATION_ERROR");
    }
    if (!body.role?.trim()) {
      return err("role is required", "VALIDATION_ERROR");
    }
    if (!body.agentType?.trim()) {
      return err("agentType is required", "VALIDATION_ERROR");
    }
    if (!body.description?.trim()) {
      return err("description is required", "VALIDATION_ERROR");
    }

    const validAgentTypes: AgentType[] = ["general-purpose", "Bash", "Explore", "Plan"];
    if (!validAgentTypes.includes(body.agentType.trim() as AgentType)) {
      return err(`agentType must be one of: ${validAgentTypes.join(", ")}`, "VALIDATION_ERROR");
    }

    // Check for name uniqueness
    const existing = await db.teamMemberRole.findUnique({
      where: { name: body.name.trim() },
    });
    if (existing) {
      return err(`A role with name "${body.name.trim()}" already exists`, "CONFLICT", 409);
    }

    const newRole = await db.teamMemberRole.create({
      data: {
        name: body.name.trim(),
        role: body.role.trim(),
        agentType: body.agentType.trim(),
        description: body.description.trim(),
        isPreset: false,
      },
    });

    return created(newRole);
  } catch (e) {
    return serverError(e);
  }
}
