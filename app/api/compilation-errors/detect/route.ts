/**
 * POST /api/compilation-errors/detect
 *
 * Runs the project's build / type-check command, parses the output for errors,
 * and creates CompilationError records for each one found.
 *
 * Body: { projectPath: string; autoHeal?: boolean }
 *
 * If autoHeal is true, healing is triggered immediately for each detected error.
 */
import { NextRequest, NextResponse } from "next/server";
import { ok, err, serverError, validateProjectPath } from "@/lib/api-helpers";
import {
  classifyError,
  parseErrorLocation,
  chooseStrategy,
  reportError,
  healError,
  verifyBuild,
} from "@/lib/self-healer";
import { db } from "@/lib/db";

// Very rough heuristic: split the build output on lines that look like error
// starts.  Handles tsc, Next.js, and ESLint formats.
function splitErrorBlocks(output: string): string[] {
  if (!output.trim()) return [];

  // Collect chunks that start with a recognisable error prefix
  const lines = output.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isErrorStart =
      /error TS\d+/i.test(line) ||
      /^\s*error:/i.test(line) ||
      /\.(ts|tsx|js|jsx)\(\d+,\d+\)/.test(line) ||
      /\.(ts|tsx|js|jsx):\d+:\d+/.test(line) ||
      /^Error:/i.test(line);

    if (isErrorStart && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0 && current.some((l) => l.trim())) {
    blocks.push(current.join("\n"));
  }

  // Deduplicate: if only one block or output is small, treat whole output as one error
  if (blocks.length === 0) return [output];
  return blocks;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      projectPath?: string;
      autoHeal?: boolean;
    };

    if (!body.projectPath || typeof body.projectPath !== "string" || !body.projectPath.trim()) {
      return err("projectPath is required", "VALIDATION_ERROR");
    }

    if (!process.env.ANTHROPIC_API_KEY && body.autoHeal) {
      return err(
        "ANTHROPIC_API_KEY is not set — cannot run autoHeal without AI",
        "CONFIGURATION_ERROR",
        503
      );
    }

    const pathCheck = validateProjectPath(body.projectPath);
    if (!pathCheck.valid) return pathCheck.error;
    const projectPath = pathCheck.resolved;
    const autoHeal    = body.autoHeal ?? false;

    // Run the build to capture current errors
    const buildResult = verifyBuild(projectPath);

    if (buildResult.success) {
      return ok({
        projectPath,
        buildPassed: true,
        errorsDetected: 0,
        errorsCreated: [],
        healingResults: [],
      });
    }

    // Parse error blocks
    const errorBlocks = splitErrorBlocks(buildResult.output);
    const created: number[] = [];
    const skippedDuplicates: number[] = [];

    for (const block of errorBlocks) {
      if (!block.trim()) continue;

      const location = parseErrorLocation(block);
      const errorType = classifyError(block);
      const strategy  = chooseStrategy(block);

      // Check if an identical pending/healing error already exists for this project+message
      const existing = await db.compilationError.findFirst({
        where: {
          projectPath,
          errorMessage: { contains: block.slice(0, 200).trim() },
          status: { in: ["pending", "healing"] },
        },
      });

      if (existing) {
        skippedDuplicates.push(existing.id);
        continue;
      }

      const id = await reportError({
        projectPath,
        errorMessage: block.trim(),
        errorType,
        filePath: location.filePath ?? undefined,
        lineNumber: location.lineNumber ?? undefined,
      });

      // Store the chosen strategy
      await db.compilationError.update({
        where: { id },
        data: { healingStrategy: strategy },
      });

      created.push(id);
    }

    // Auto-heal if requested
    const healingResults = [];
    if (autoHeal && created.length > 0) {
      for (const id of created) {
        try {
          const result = await healError(id);
          healingResults.push(result);
        } catch (e) {
          healingResults.push({
            compilationErrorId: id,
            success: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return ok({
      projectPath,
      buildPassed: false,
      errorsDetected: errorBlocks.length,
      errorsCreated: created,
      skippedDuplicates,
      healingResults,
    });
  } catch (e) {
    return serverError(e);
  }
}
