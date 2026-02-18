import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig } from "@/lib/claude-files";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import {
  readBackgroundConfig,
  writeBackgroundConfig,
  resetWakeRetries,
  DEFAULT_BACKGROUND_CONFIG,
} from "@/lib/sleep-detector";
import type { BackgroundConfig } from "@/types";

// GET /api/teams/[name]/background — read background execution config
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const config = readBackgroundConfig(name);
    return ok(config);
  } catch (e) {
    return serverError(e);
  }
}

// PUT /api/teams/[name]/background — update background execution config
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = (await req.json()) as Partial<BackgroundConfig>;

    // Validate wakeStrategy
    if (body.wakeStrategy && !["immediate", "scheduled"].includes(body.wakeStrategy)) {
      return err('wakeStrategy must be "immediate" or "scheduled"', "VALIDATION_ERROR");
    }

    // Validate numeric fields
    if (body.wakeDelaySeconds !== undefined && (typeof body.wakeDelaySeconds !== "number" || body.wakeDelaySeconds < 0)) {
      return err("wakeDelaySeconds must be a non-negative number", "VALIDATION_ERROR");
    }
    if (body.maxWakeRetries !== undefined && (typeof body.maxWakeRetries !== "number" || body.maxWakeRetries < 0)) {
      return err("maxWakeRetries must be a non-negative number", "VALIDATION_ERROR");
    }

    const current = readBackgroundConfig(name);
    const updated: BackgroundConfig = {
      ...current,
      ...(body.persistent !== undefined && { persistent: body.persistent }),
      ...(body.wakeStrategy !== undefined && { wakeStrategy: body.wakeStrategy }),
      ...(body.wakeDelaySeconds !== undefined && { wakeDelaySeconds: body.wakeDelaySeconds }),
      ...(body.maxWakeRetries !== undefined && { maxWakeRetries: body.maxWakeRetries }),
    };

    writeBackgroundConfig(name, updated);
    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}

// DELETE /api/teams/[name]/background — reset to defaults
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    writeBackgroundConfig(name, { ...DEFAULT_BACKGROUND_CONFIG });
    resetWakeRetries(name);
    return ok({ reset: true });
  } catch (e) {
    return serverError(e);
  }
}
