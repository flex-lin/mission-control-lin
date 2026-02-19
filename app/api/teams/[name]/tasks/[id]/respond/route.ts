import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig, readTask, writeTask } from "@/lib/claude-files";
import { ok, notFound, err, serverError, safeName } from "@/lib/api-helpers";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// POST /api/teams/[name]/tasks/[id]/respond — respond to a stuck task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> }
): Promise<NextResponse> {
  try {
    const { name, id } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");
    if (!safeName(id)) return err("Invalid task ID", "VALIDATION_ERROR");
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const task = readTask(name, id);
    if (!task) return notFound(`Task "${id}" not found in team "${name}"`);

    const body = (await req.json()) as {
      action?: string;
      message?: string;
      assignTo?: string;
    };

    if (!body.action || !["message", "reassign", "cancel"].includes(body.action)) {
      return err('action must be "message", "reassign", or "cancel"', "VALIDATION_ERROR");
    }

    const timestamp = new Date().toISOString();

    if (body.action === "message") {
      if (!body.message || typeof body.message !== "string") {
        return err("message is required for message action", "VALIDATION_ERROR");
      }

      // Send message to the task owner's inbox
      const recipient = task.owner ?? "leader";
      const inboxPath = path.join(CLAUDE_DIR, "teams", name, "inboxes", `${recipient}.json`);
      const resolvedPath = path.resolve(inboxPath);
      if (!resolvedPath.startsWith(path.resolve(CLAUDE_DIR) + path.sep)) {
        return err("Path traversal blocked", "SECURITY_ERROR", 403);
      }

      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

      let messages: unknown[] = [];
      if (fs.existsSync(resolvedPath)) {
        try {
          messages = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as unknown[];
        } catch {
          /* start fresh */
        }
      }

      const blockerContext = task.metadata?.blockerSummary
        ? ` (Blocker: ${task.metadata.blockerSummary})`
        : "";

      messages.push({
        id: `msg-${Date.now()}`,
        from: "dashboard",
        to: recipient,
        content: `[Re: Task #${task.id} — ${task.subject}${blockerContext}] ${body.message}`,
        timestamp,
      });

      fs.writeFileSync(resolvedPath, JSON.stringify(messages, null, 2), "utf-8");

      // Clear blocker metadata and record response
      const { blockerSummary, blockerType, blockerDetails, blockerSince, blockerFrom, ...restMetadata } =
        (task.metadata ?? {}) as Record<string, unknown>;
      task.metadata = {
        ...restMetadata,
        lastUserResponse: timestamp,
        lastUserMessage: body.message,
      };
      writeTask(name, task);

      return ok({ action: "message", recipient, taskId: id });
    }

    if (body.action === "reassign") {
      if (!body.assignTo || typeof body.assignTo !== "string") {
        return err("assignTo is required for reassign action", "VALIDATION_ERROR");
      }

      const member = team.members.find((m) => m.name === body.assignTo);
      if (!member) {
        return notFound(`Teammate "${body.assignTo}" not found in team "${name}"`);
      }

      const previousOwner = task.owner;

      // Clear blocker metadata and record reassignment
      const { blockerSummary: _bs, blockerType: _bt, blockerDetails: _bd, blockerSince: _bsi, blockerFrom: _bf, ...restMeta } =
        (task.metadata ?? {}) as Record<string, unknown>;
      task.owner = body.assignTo;
      task.metadata = {
        ...restMeta,
        reassignedAt: timestamp,
        reassignedFrom: previousOwner,
      };
      writeTask(name, task);

      // Send inbox message to new owner
      const newOwnerInboxPath = path.join(CLAUDE_DIR, "teams", name, "inboxes", `${body.assignTo}.json`);
      const resolvedNewOwnerPath = path.resolve(newOwnerInboxPath);
      if (resolvedNewOwnerPath.startsWith(path.resolve(CLAUDE_DIR) + path.sep)) {
        fs.mkdirSync(path.dirname(resolvedNewOwnerPath), { recursive: true });

        let ownerMessages: unknown[] = [];
        if (fs.existsSync(resolvedNewOwnerPath)) {
          try {
            ownerMessages = JSON.parse(fs.readFileSync(resolvedNewOwnerPath, "utf-8")) as unknown[];
          } catch { /* start fresh */ }
        }

        ownerMessages.push({
          id: `msg-${Date.now()}`,
          from: "dashboard",
          to: body.assignTo,
          content: `Task #${task.id} ("${task.subject}") has been reassigned to you from ${previousOwner ?? "unassigned"}.${body.message ? ` Note: ${body.message}` : ""}`,
          timestamp,
        });

        fs.writeFileSync(resolvedNewOwnerPath, JSON.stringify(ownerMessages, null, 2), "utf-8");
      }

      return ok({ action: "reassign", assignTo: body.assignTo, taskId: id });
    }

    // cancel
    task.status = "deleted";
    task.metadata = {
      ...task.metadata,
      cancelledAt: timestamp,
      cancelledBy: "dashboard",
    };
    writeTask(name, task);

    // Send cancellation notice to task owner
    const cancelRecipient = task.owner ?? "leader";
    const cancelInboxPath = path.join(CLAUDE_DIR, "teams", name, "inboxes", `${cancelRecipient}.json`);
    const resolvedCancelPath = path.resolve(cancelInboxPath);
    if (resolvedCancelPath.startsWith(path.resolve(CLAUDE_DIR) + path.sep)) {
      fs.mkdirSync(path.dirname(resolvedCancelPath), { recursive: true });

      let cancelMessages: unknown[] = [];
      if (fs.existsSync(resolvedCancelPath)) {
        try {
          cancelMessages = JSON.parse(fs.readFileSync(resolvedCancelPath, "utf-8")) as unknown[];
        } catch { /* start fresh */ }
      }

      cancelMessages.push({
        id: `msg-${Date.now()}`,
        from: "dashboard",
        to: cancelRecipient,
        content: `Task #${task.id} ("${task.subject}") has been cancelled.${body.message ? ` Reason: ${body.message}` : ""}`,
        timestamp,
      });

      fs.writeFileSync(resolvedCancelPath, JSON.stringify(cancelMessages, null, 2), "utf-8");
    }

    return ok({ action: "cancel", taskId: id });
  } catch (e) {
    return serverError(e);
  }
}
