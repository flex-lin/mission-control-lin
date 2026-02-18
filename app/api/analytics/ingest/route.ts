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
  teamName?: string;
  agentName?: string;
  message?: {
    role?: string;
    model?: string;
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

    let totalIngested = 0;
    let totalSkipped = 0;

    for (const dir of targetDirs) {
      const dirPath = path.join(projectsDir, dir.name);
      const jsonlFiles = fs.readdirSync(dirPath)
        .filter((f) => f.endsWith(".jsonl"));

      for (const file of jsonlFiles) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);

        // Skip files older than cutoff
        if (stat.mtime < cutoff) {
          totalSkipped++;
          continue;
        }

        try {
          const entries = await parseJsonlFile(filePath);

          // Extract session-level metadata from entries (agentName/teamName
          // are typically on the first entry but we scan until found)
          let sessionTeamName: string | null = null;
          let sessionMemberName: string | null = null;
          for (const e of entries) {
            if (!sessionTeamName && e.teamName) sessionTeamName = e.teamName;
            if (!sessionMemberName && e.agentName) sessionMemberName = e.agentName;
            if (sessionTeamName && sessionMemberName) break;
          }

          // Fall back to extracting team from directory name
          const teamName = sessionTeamName ?? extractTeamFromPath(dir.name);

          for (const entry of entries) {
            // Look for assistant messages with usage data
            const usage = entry.usage ?? entry.message?.usage;
            const model = entry.model ?? entry.message?.model;

            if (!usage || !model) continue;

            const inputTokens =
              (usage.input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0);
            const outputTokens = usage.output_tokens ?? 0;

            if (inputTokens === 0 && outputTokens === 0) continue;

            // Check if this entry already exists (deduplicate by timestamp + model + tokens)
            const timestamp = entry.timestamp
              ? new Date(entry.timestamp)
              : stat.mtime;

            const existing = await db.proxyLog.findFirst({
              where: {
                model,
                inputTokens,
                outputTokens,
                timestamp: {
                  gte: new Date(timestamp.getTime() - 1000),
                  lte: new Date(timestamp.getTime() + 1000),
                },
              },
            });

            if (existing) {
              totalSkipped++;
              continue;
            }

            await db.proxyLog.create({
              data: {
                model,
                inputTokens,
                outputTokens,
                teamName,
                memberName: entry.agentName ?? sessionMemberName,
                endpoint: "/v1/messages",
                latencyMs: entry.durationMs ?? 0,
                statusCode: 200,
                timestamp,
              },
            });

            totalIngested++;
          }
        } catch {
          // Skip unparseable files
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
