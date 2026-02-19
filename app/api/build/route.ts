import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import os from "os"
import { ok, err, serverError, validateProjectPath } from "@/lib/api-helpers"
import { NextRequest } from "next/server"
import type { BuildRecord } from "@/types"

export const dynamic = "force-dynamic"

// File-based storage for build history (~/.claude/build-history.json)
const BUILD_HISTORY_PATH = path.join(os.homedir(), ".claude", "build-history.json")
const MAX_BUILD_HISTORY = 20

function readBuildHistory(): BuildRecord[] {
  try {
    if (!fs.existsSync(BUILD_HISTORY_PATH)) return []
    const raw = fs.readFileSync(BUILD_HISTORY_PATH, "utf-8")
    return JSON.parse(raw) as BuildRecord[]
  } catch {
    return []
  }
}

function writeBuildHistory(records: BuildRecord[]): void {
  try {
    const dir = path.dirname(BUILD_HISTORY_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(BUILD_HISTORY_PATH, JSON.stringify(records, null, 2), "utf-8")
  } catch {
    // best-effort
  }
}

function appendBuildRecord(record: BuildRecord): void {
  const history = readBuildHistory()
  history.unshift(record)
  // Keep only last MAX_BUILD_HISTORY records
  writeBuildHistory(history.slice(0, MAX_BUILD_HISTORY))
}

function updateBuildRecord(id: string, updates: Partial<BuildRecord>): void {
  const history = readBuildHistory()
  const idx = history.findIndex((r) => r.id === id)
  if (idx !== -1) {
    history[idx] = { ...history[idx], ...updates }
    writeBuildHistory(history)
  }
}

// Track in-flight build so we don't run two at once
let activeBuildId: string | null = null

/** GET /api/build — return build history */
export async function GET() {
  try {
    const history = readBuildHistory()
    return ok({
      history,
      isRunning: activeBuildId !== null,
      activeBuildId,
    })
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/build — trigger a new build and optionally auto-heal */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      projectPath?: string
      autoHeal?: boolean
    }

    if (activeBuildId !== null) {
      return err("A build is already in progress.", "BUILD_IN_PROGRESS", 409)
    }

    const rawPath = body.projectPath ?? process.cwd()
    const pathCheck = validateProjectPath(rawPath)
    if (!pathCheck.valid) return pathCheck.error
    const projectPath = pathCheck.resolved
    const autoHeal = body.autoHeal ?? false

    const id = `build-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const record: BuildRecord = {
      id,
      projectPath,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      exitCode: null,
      output: "",
      errorOutput: "",
      autoHeal,
      healTaskId: null,
    }

    appendBuildRecord(record)
    activeBuildId = id

    // Run the build asynchronously — do not await
    runBuild(id, projectPath, autoHeal).catch(() => {
      // Ensure activeBuildId is cleared even if something throws
      if (activeBuildId === id) activeBuildId = null
    })

    return ok({ id, status: "running", startedAt: record.startedAt })
  } catch (e) {
    return serverError(e)
  }
}

async function runBuild(buildId: string, projectPath: string, autoHeal: boolean): Promise<void> {
  return new Promise((resolve) => {
    // Use the same pnpm / node env as the rest of the system
    const pnpmBin = process.env.PNPM_HOME
      ? path.join(process.env.PNPM_HOME, "pnpm")
      : "pnpm"

    const proc = spawn(pnpmBin, ["build"], {
      cwd: projectPath,
      env: {
        ...process.env,
        // Ensure nvm node is on PATH if available
        PATH: process.env.PATH ?? "",
      },
      // shell: false (default) — prevents command injection via cwd or env
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on("close", async (code) => {
      if (activeBuildId === buildId) activeBuildId = null

      const success = code === 0
      const completedAt = new Date().toISOString()

      updateBuildRecord(buildId, {
        status: success ? "success" : "failed",
        completedAt,
        exitCode: code ?? -1,
        output: stdout.slice(0, 20000),   // cap at 20KB
        errorOutput: stderr.slice(0, 20000),
      })

      // Auto-heal: if build failed and autoHeal is enabled, create a CompilationError
      // record and trigger the self-healing pipeline
      if (!success && autoHeal) {
        try {
          const fullOutput = [stdout, stderr].filter(Boolean).join("\n")
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3777"

          // 1. Report the compilation error to the self-healing system
          const reportRes = await fetch(`${baseUrl}/api/self-healing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectPath,
              errorMessage: fullOutput.slice(0, 5000),
              errorType: detectErrorType(fullOutput),
            }),
          })

          if (reportRes.ok) {
            const reportJson = await reportRes.json() as { data?: { id?: number } }
            const errorId = reportJson.data?.id

            if (errorId) {
              // 2. Immediately trigger healing for the new error
              const healRes = await fetch(`${baseUrl}/api/self-healing/${errorId}/heal`, {
                method: "POST",
              })
              if (healRes.ok) {
                const healJson = await healRes.json() as { data?: { queueTaskId?: number } }
                const healTaskId = healJson.data?.queueTaskId ?? null
                updateBuildRecord(buildId, { healTaskId })
              }
            }
          } else {
            // Fallback: directly submit to queue if self-healing API fails
            const goal = buildErrorHealingGoal(fullOutput, projectPath)
            const res = await fetch(`${baseUrl}/api/queue`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goal, projectPath }),
            })
            if (res.ok) {
              const json = await res.json() as { data?: { id?: number } }
              const healTaskId = json.data?.id ?? null
              updateBuildRecord(buildId, { healTaskId })
            }
          }
        } catch {
          // best-effort — don't fail the build record if auto-heal request fails
        }
      }

      resolve()
    })

    proc.on("error", () => {
      if (activeBuildId === buildId) activeBuildId = null
      updateBuildRecord(buildId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        exitCode: -1,
        errorOutput: "Failed to spawn build process. Is pnpm installed?",
      })
      resolve()
    })
  })
}

function detectErrorType(output: string): "typescript" | "build" | "lint" | "runtime" {
  if (/TS\d{4}:|error TS|TypeScript/.test(output)) return "typescript"
  if (/ESLint|eslint|no-unused|no-explicit-any/.test(output)) return "lint"
  if (/ReferenceError|TypeError|SyntaxError/.test(output)) return "runtime"
  return "build"
}

function buildErrorHealingGoal(output: string, projectPath: string): string {
  // Extract the most relevant error lines to keep the goal concise
  const lines = output.split("\n")
  const errorLines = lines
    .filter((l) =>
      /error\b|Error\b|TS\d{4}:|failed|FAIL/.test(l) &&
      !/^\s*$/.test(l)
    )
    .slice(0, 10)

  const snippet = errorLines.length > 0
    ? errorLines.join("\n").slice(0, 800)
    : output.slice(0, 800)

  return (
    `Fix compilation/build errors in the project at ${projectPath}.\n\n` +
    `The following errors were detected when running \`pnpm build\`:\n\n` +
    `\`\`\`\n${snippet}\n\`\`\`\n\n` +
    `After fixing, verify the build succeeds by running \`pnpm build\` again.`
  )
}
