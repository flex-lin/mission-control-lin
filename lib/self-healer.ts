/**
 * Self-Healer — business logic for detecting, analysing, and fixing
 * compilation errors automatically via Claude AI.
 *
 * Flow:
 *   1. Error is reported via reportError()
 *   2. analyseError() classifies the error and chooses a healing strategy
 *   3. healError() asks Claude to produce file patches and applies them
 *   4. verifyHeal() runs the build again to confirm the fix worked
 *   5. If the build still fails and retries remain, the cycle repeats
 */

import path from "path";
import fs from "fs";
import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type {
  CompilationErrorType,
  HealingStrategy,
  HealingResult,
} from "@/types";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_PATCH_FILE_CHARS = 8_000;   // max chars we send to Claude per file
const MAX_ERROR_CHARS      = 4_000;   // max error message chars sent to Claude
const BUILD_TIMEOUT_MS     = 120_000; // 2 min limit for build verification

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…(truncated)";
}

/**
 * Run a shell command and capture stdout+stderr.
 * Returns { output, exitCode }.
 */
function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs = BUILD_TIMEOUT_MS
): { output: string; exitCode: number } {
  const opts: ExecSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: "pipe",
    env: { ...process.env, CI: "true" },
  };
  try {
    const output = execSync(cmd, opts);
    return { output: output ?? "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number };
    const output = [err.stdout ?? "", err.stderr ?? ""].join("\n").trim();
    return { output, exitCode: err.status ?? 1 };
  }
}

// ── Error Classification ──────────────────────────────────────────────────────

/** Heuristically determine the error type from the raw compiler output. */
export function classifyError(errorMessage: string): CompilationErrorType {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("ts(") || msg.includes("typescript") || /error ts\d+/.test(msg)) {
    return "typescript";
  }
  if (msg.includes("eslint") || msg.includes("lint")) {
    return "lint";
  }
  if (msg.includes("syntaxerror") || msg.includes("unexpected token")) {
    return "runtime";
  }
  return "build";
}

/**
 * Attempt to extract the file path and line number from a compiler error.
 * Supports common TypeScript and tsc-style output:
 *   src/foo/bar.ts(12,5): error TS1234: …
 *   src/foo/bar.ts:12:5 - error …
 */
export function parseErrorLocation(errorMessage: string): {
  filePath: string | null;
  lineNumber: number | null;
} {
  // tsc style: path(line,col)
  const tscMatch = errorMessage.match(/^([^\s(]+\.tsx?)\((\d+),\d+\)/m);
  if (tscMatch) {
    return { filePath: tscMatch[1], lineNumber: parseInt(tscMatch[2], 10) };
  }
  // colon style: path:line:col
  const colonMatch = errorMessage.match(/([^\s:]+\.tsx?):(\d+):\d+/);
  if (colonMatch) {
    return { filePath: colonMatch[1], lineNumber: parseInt(colonMatch[2], 10) };
  }
  return { filePath: null, lineNumber: null };
}

/**
 * Choose the best healing strategy based on error content.
 * Returns a coarse strategy label; Claude will still have full autonomy
 * over the actual fix.
 */
export function chooseStrategy(errorMessage: string): HealingStrategy {
  const msg = errorMessage.toLowerCase();
  if (
    msg.includes("cannot find module") ||
    msg.includes("module not found") ||
    msg.includes("has no exported member")
  ) {
    return "fix_imports";
  }
  if (
    msg.includes("type ") &&
    (msg.includes(" is not assignable") ||
      msg.includes("missing property") ||
      msg.includes("does not exist on type"))
  ) {
    return "fix_types";
  }
  if (
    msg.includes("unexpected token") ||
    msg.includes("expected") ||
    msg.includes("missing") ||
    msg.includes("syntaxerror")
  ) {
    return "fix_syntax";
  }
  return "custom";
}

// ── File Patch Application ────────────────────────────────────────────────────

interface FilePatch {
  filePath: string;
  content: string; // full new file content to replace with
}

/**
 * Apply an array of file patches to disk.
 * Patches are absolute or relative to `projectPath`.
 */
function applyPatches(patches: FilePatch[], projectPath: string): void {
  for (const patch of patches) {
    const absPath = path.isAbsolute(patch.filePath)
      ? patch.filePath
      : path.join(projectPath, patch.filePath);

    // Safety: patch must be within the project directory
    const resolved = path.resolve(absPath);
    const projResolved = path.resolve(projectPath);
    if (!resolved.startsWith(projResolved + path.sep) && resolved !== projResolved) {
      throw new Error(`Patch path "${patch.filePath}" is outside the project directory`);
    }

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, patch.content, "utf-8");
  }
}

// ── Build Verification ────────────────────────────────────────────────────────

/**
 * Run the project's type-check / build command and return whether it succeeded.
 */
export function verifyBuild(projectPath: string): {
  success: boolean;
  output: string;
} {
  // Validate projectPath is an absolute, existing directory
  const resolved = path.resolve(projectPath);
  if (!path.isAbsolute(resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { success: false, output: `Invalid project path: ${projectPath}` };
  }

  // Choose build command from a fixed allowlist — never execute user-controlled strings
  const ALLOWED_CMDS = ["pnpm type-check", "pnpm build", "npx tsc --noEmit"] as const;
  let buildCmd: string = ALLOWED_CMDS[2]; // default: npx tsc --noEmit

  const packageJsonPath = path.join(resolved, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.["type-check"]) {
        buildCmd = ALLOWED_CMDS[0];
      } else if (pkg.scripts?.build) {
        buildCmd = ALLOWED_CMDS[1];
      }
    } catch {
      // fallthrough to default
    }
  }

  const { output, exitCode } = runCommand(buildCmd, resolved);
  return { success: exitCode === 0, output };
}

// ── AI-Powered Healing ────────────────────────────────────────────────────────

/**
 * Ask Claude to analyse the error and produce file patches.
 * Returns an array of FilePatch objects parsed from the model response.
 */
async function askClaudeForFix(
  errorMessage: string,
  errorType: CompilationErrorType,
  strategy: HealingStrategy,
  filePath: string | null,
  projectPath: string
): Promise<FilePatch[]> {
  const client = getAnthropicClient();

  // Read the affected source file (if we know which one)
  let fileContext = "";
  if (filePath) {
    const absFilePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(projectPath, filePath);
    if (fs.existsSync(absFilePath)) {
      const raw = fs.readFileSync(absFilePath, "utf-8");
      fileContext = `\n\nFile: ${filePath}\n\`\`\`\n${truncate(raw, MAX_PATCH_FILE_CHARS)}\n\`\`\``;
    }
  }

  const systemPrompt = `You are an expert TypeScript/JavaScript developer and build-system debugger.
Your job is to fix compilation errors in a Next.js / TypeScript project.
When given an error, you MUST respond with a JSON array of file patches ONLY — no prose before or after.

Each patch object has this shape:
{
  "filePath": "relative/path/from/project/root.ts",
  "content": "<full new content of the file>"
}

Rules:
- Produce the minimum set of changes required to fix the error.
- Always return valid, compilable TypeScript/TSX.
- Never add "as any" or "@ts-ignore" unless absolutely unavoidable.
- If the error is in a generated file (e.g. prisma client), fix the source that generates it instead.
- Return an empty array [] if the error cannot be fixed with file patches (e.g. missing dependency).`;

  const userPrompt = `Fix the following ${errorType} compilation error.
Strategy hint: ${strategy}

Error:
\`\`\`
${truncate(errorMessage, MAX_ERROR_CHARS)}
\`\`\`
${fileContext}

Respond with a JSON array of file patches only.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  // Parse the JSON array from the response — handle markdown code fences
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ??
    text.match(/(\[[\s\S]*\])/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text.trim();

  try {
    const patches = JSON.parse(jsonStr) as FilePatch[];
    if (!Array.isArray(patches)) return [];
    return patches.filter(
      (p) =>
        typeof p.filePath === "string" &&
        typeof p.content === "string"
    );
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Report a compilation error to the database so it can be healed later.
 * Returns the created record id.
 */
export async function reportError(params: {
  projectPath: string;
  errorMessage: string;
  errorType?: CompilationErrorType;
  filePath?: string;
  lineNumber?: number;
}): Promise<number> {
  const errorType = params.errorType ?? classifyError(params.errorMessage);
  const location = parseErrorLocation(params.errorMessage);

  const record = await db.compilationError.create({
    data: {
      projectPath: params.projectPath,
      errorMessage: params.errorMessage,
      errorType,
      filePath: params.filePath ?? location.filePath,
      lineNumber: params.lineNumber ?? location.lineNumber,
      status: "pending",
      healingStrategy: chooseStrategy(params.errorMessage),
    },
  });

  return record.id;
}

/**
 * Attempt to heal a compilation error by id.
 * Returns a HealingResult describing what happened.
 *
 * This is the main entry-point for the self-healing loop.
 */
export async function healError(compilationErrorId: number): Promise<HealingResult> {
  const startTime = Date.now();

  const record = await db.compilationError.findUnique({
    where: { id: compilationErrorId },
    include: { healingAttempts: true },
  });

  if (!record) {
    throw new Error(`CompilationError #${compilationErrorId} not found`);
  }

  if (record.status === "healed") {
    return {
      compilationErrorId,
      success: true,
      attemptNumber: record.retryCount,
      strategy: record.healingStrategy ?? "custom",
      resolution: record.resolution ?? "Already healed",
      durationMs: 0,
    };
  }

  if (record.retryCount >= record.maxRetries) {
    await db.compilationError.update({
      where: { id: compilationErrorId },
      data: { status: "failed" },
    });
    return {
      compilationErrorId,
      success: false,
      attemptNumber: record.retryCount,
      strategy: record.healingStrategy ?? "custom",
      remainingErrors: "Max retries reached",
      durationMs: Date.now() - startTime,
    };
  }

  const attemptNumber = record.retryCount + 1;
  const strategy = (record.healingStrategy ?? "custom") as HealingStrategy;

  // Mark as healing
  await db.compilationError.update({
    where: { id: compilationErrorId },
    data: { status: "healing", retryCount: attemptNumber },
  });

  let patchJson: string | null = null;
  let buildOutput: string | null = null;
  let success = false;
  let errorAfter: string | null = null;
  let resolution: string | undefined;

  try {
    // Ask Claude for patches
    const patches = await askClaudeForFix(
      record.errorMessage,
      record.errorType as CompilationErrorType,
      strategy,
      record.filePath,
      record.projectPath
    );

    patchJson = JSON.stringify(patches);

    if (patches.length === 0) {
      // Claude couldn't produce a fix — mark as skipped
      await db.compilationError.update({
        where: { id: compilationErrorId },
        data: { status: "skipped", resolution: "No patch produced by AI" },
      });

      await db.healingAttempt.create({
        data: {
          compilationErrorId,
          attemptNumber,
          strategy,
          patch: patchJson,
          buildOutput: null,
          success: false,
          errorAfter: "No patch produced",
          durationMs: Date.now() - startTime,
        },
      });

      return {
        compilationErrorId,
        success: false,
        attemptNumber,
        strategy,
        remainingErrors: "No patch produced by AI",
        durationMs: Date.now() - startTime,
      };
    }

    // Apply patches to disk
    applyPatches(patches, record.projectPath);

    // Verify the build now passes
    const buildResult = verifyBuild(record.projectPath);
    buildOutput = truncate(buildResult.output, 6_000);
    success = buildResult.success;

    if (success) {
      resolution = `Fixed via ${strategy} (attempt #${attemptNumber}): applied ${patches.length} file patch(es)`;
      await db.compilationError.update({
        where: { id: compilationErrorId },
        data: {
          status: "healed",
          resolution,
          healedAt: new Date(),
        },
      });
    } else {
      errorAfter = truncate(buildResult.output, 2_000);
      // Still failing — will be eligible for another retry
      await db.compilationError.update({
        where: { id: compilationErrorId },
        data: {
          status: record.retryCount + 1 >= record.maxRetries ? "failed" : "pending",
          errorMessage: buildResult.output || record.errorMessage,
        },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorAfter = msg;
    await db.compilationError.update({
      where: { id: compilationErrorId },
      data: { status: "pending" }, // will be retried
    });
  }

  const durationMs = Date.now() - startTime;

  // Record the attempt
  await db.healingAttempt.create({
    data: {
      compilationErrorId,
      attemptNumber,
      strategy,
      patch: patchJson,
      buildOutput,
      success,
      errorAfter,
      durationMs,
    },
  });

  return {
    compilationErrorId,
    success,
    attemptNumber,
    strategy,
    resolution,
    remainingErrors: errorAfter ?? undefined,
    durationMs,
  };
}

/**
 * Get statistics about all self-healing activity for a project.
 */
export async function getSelfHealingStats(projectPath?: string) {
  const where = projectPath ? { projectPath } : {};
  const counts = await db.compilationError.groupBy({
    by: ["status"],
    _count: { status: true },
    where,
  });

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));
  const total = Object.values(countMap).reduce((a, b) => a + b, 0);
  const healed = countMap["healed"] ?? 0;

  return {
    total,
    pending: countMap["pending"] ?? 0,
    healing: countMap["healing"] ?? 0,
    healed,
    failed: countMap["failed"] ?? 0,
    skipped: countMap["skipped"] ?? 0,
    successRate: total > 0 ? Math.round((healed / total) * 100) : 0,
  };
}
