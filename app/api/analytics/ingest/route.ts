import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, err, serverError } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";
import readline from "readline";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

interface SessionLogEntry {
  type?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  costUSD?: number;
  durationMs?: number;
  timestamp?: string;
  sessionId?: string;
  parentMessageId?: string;
  requestId?: string;
  teamName?: string;
  agentName?: string;
  message?: {
    role?: string;
    model?: string;
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

// POST /api/analytics/ingest — scan Claude Code session logs and import usage data
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      projectDir?: string;
      daysBack?: number;
    };

    const daysBack = body.daysBack ?? 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    // Find session JSONL files
    const projectsDir = path.join(CLAUDE_DIR, "projects");
    if (!fs.existsSync(projectsDir)) {
      return err("No Claude projects directory found", "NOT_FOUND", 404);
    }

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    // If a specific project dir is requested, filter
    const targetDirs = body.projectDir
      ? projectDirs.filter((d) => d.name.includes(body.projectDir!.replace(/\//g, "-")))
      : projectDirs;

    // Clear existing ingested records (endpoint = /v1/messages, latencyMs = 0)
    // to avoid duplicates on re-ingest. Proxy-captured records have real latency values.
    await db.proxyLog.deleteMany({
      where: {
        endpoint: "/v1/messages",
        latencyMs: 0,
      },
    });

    let totalIngested = 0;
    let totalSkipped = 0;

    for (const dir of targetDirs) {
      const dirPath = path.join(projectsDir, dir.name);

      // Collect JSONL files including subagent directories
      const jsonlFiles: string[] = [];
      collectJsonlFiles(dirPath, jsonlFiles);

      for (const filePath of jsonlFiles) {
        const stat = fs.statSync(filePath);

        // Skip files older than cutoff
        if (stat.mtime < cutoff) {
          totalSkipped++;
          continue;
        }

        try {
          const entries = await parseJsonlFile(filePath);

          // Extract session-level metadata from entries
          let sessionTeamName: string | null = null;
          let sessionMemberName: string | null = null;
          for (const e of entries) {
            if (!sessionTeamName && e.teamName) sessionTeamName = e.teamName;
            if (!sessionMemberName && e.agentName) sessionMemberName = e.agentName;
            if (sessionTeamName && sessionMemberName) break;
          }

          // Fall back to extracting team from directory name
          const teamName = sessionTeamName ?? extractTeamFromPath(dir.name);

          // Collect the LAST entry per requestId — streaming chunks accumulate
          // output tokens, so only the final entry has the correct count.
          const requestMap = new Map<string, {
            model: string;
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheCreationTokens: number;
            teamName: string | null;
            memberName: string | null;
            endpoint: string;
            latencyMs: number;
            statusCode: number;
            timestamp: Date;
          }>();

          for (const entry of entries) {
            // Look for assistant messages with usage data
            const usage = entry.usage ?? entry.message?.usage;
            const model = entry.model ?? entry.message?.model;

            if (!usage || !model) continue;

            const baseInput = usage.input_tokens ?? 0;
            const cacheRead = usage.cache_read_input_tokens ?? 0;
            const cacheCreate = usage.cache_creation_input_tokens ?? 0;
            const outputTokens = usage.output_tokens ?? 0;

            if (baseInput === 0 && cacheRead === 0 && cacheCreate === 0 && outputTokens === 0) continue;

            const requestId = entry.requestId ?? entry.message?.id ?? crypto.randomUUID();

            const timestamp = entry.timestamp
              ? new Date(entry.timestamp)
              : stat.mtime;

            // Always overwrite — last entry per requestId has final token counts
            requestMap.set(requestId, {
              model,
              inputTokens: baseInput,
              outputTokens,
              cacheReadTokens: cacheRead,
              cacheCreationTokens: cacheCreate,
              teamName,
              memberName: entry.agentName ?? sessionMemberName,
              endpoint: "/v1/messages",
              latencyMs: entry.durationMs ?? 0,
              statusCode: 200,
              timestamp,
            });
          }

          const pendingRecords = Array.from(requestMap.values());

          if (pendingRecords.length > 0) {
            const result = await db.proxyLog.createMany({
              data: pendingRecords,
            });
            totalIngested += result.count;
            totalSkipped += pendingRecords.length - result.count;
          }
        } catch (fileErr) {
          console.error(`[ingest] Error processing ${filePath}:`, fileErr);
          totalSkipped++;
        }
      }
    }

    return ok({
      ingested: totalIngested,
      skipped: totalSkipped,
      projectsScanned: targetDirs.length,
    });
  } catch (e) {
    return serverError(e);
  }
}

function collectJsonlFiles(dirPath: string, results: string[]): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    } else if (entry.isDirectory() && entry.name === "subagents") {
      // Include subagent session logs
      const subFiles = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const sub of subFiles) {
        if (sub.isFile() && sub.name.endsWith(".jsonl")) {
          results.push(path.join(fullPath, sub.name));
        }
      }
    }
  }
}

async function parseJsonlFile(filePath: string): Promise<SessionLogEntry[]> {
  const entries: SessionLogEntry[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as SessionLogEntry);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

function extractTeamFromPath(dirName: string): string | null {
  // Project dir names are like "-home-user-project"
  // Extract the last segment as a readable name
  const parts = dirName.split("-").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}
