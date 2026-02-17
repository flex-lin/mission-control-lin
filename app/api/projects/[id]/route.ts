import { NextRequest, NextResponse } from "next/server";
import { readProjectContext, listProjects } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function buildFileTree(dirPath: string, depth = 0): string[] {
  if (depth > 3) return [];
  const items: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = entry.isDirectory() ? `${entry.name}/` : entry.name;
      items.push(rel);
      if (entry.isDirectory() && depth < 2) {
        const sub = buildFileTree(path.join(dirPath, entry.name), depth + 1);
        items.push(...sub.map((s) => `  ${s}`));
      }
    }
  } catch { /* skip unreadable dirs */ }
  return items;
}

// GET /api/projects/[id] — project detail with CLAUDE.md, file tree, memory files
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Validate id first (no path traversal)
    const resolvedProjectDir = path.resolve(path.join(CLAUDE_DIR, "projects", id));
    const safeClaudeDir = path.resolve(CLAUDE_DIR);
    if (!resolvedProjectDir.startsWith(safeClaudeDir + path.sep)) {
      return notFound("Project not found");
    }

    // Verify project exists
    const projects = listProjects();
    const project = projects.find((p) => p.id === id);
    if (!project) return notFound(`Project "${id}" not found`);

    const context = readProjectContext(id);

    // Try to build a file tree from the actual project path
    // projectPath may be outside ~/.claude/ (by design — reading indexed project source)
    const projectPath = project.path;
    const fileTree = fs.existsSync(projectPath) ? buildFileTree(projectPath) : [];

    // Also check for a CLAUDE.md in the actual project directory
    if (!context.claudeMd) {
      const claudeMdPath = path.join(projectPath, "CLAUDE.md");
      if (fs.existsSync(claudeMdPath)) {
        context.claudeMd = fs.readFileSync(claudeMdPath, "utf-8");
      }
    }

    return ok({
      ...project,
      ...context,
      fileTree,
    });
  } catch (e) {
    return serverError(e);
  }
}
