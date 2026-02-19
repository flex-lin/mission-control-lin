import fs from "fs";
import path from "path";
import {
  getSessionName,
  sessionExists,
  createSession,
  sendKeysAndSubmit,
  getTeamSessionStatus,
  sessionProcessAlive,
  killSession,
  capturePane,
  sendRawKey,
} from "@/lib/tmux-manager";
import type { TeamPersona, TeamTask } from "@/types";

interface LaunchableMember {
  name: string;
  role: string;
  agentType: string;
  description: string;
}

const LEADER_NAME = "leader";
const SEND_DELAY_MS = 3000;
const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the Claude CLI prompt (❯) is visible, accepting any
 * confirmation dialogs along the way. This replaces fixed-time sleeps
 * with polling that adapts to actual CLI startup time.
 */
async function waitForClaudeReady(sessionName: string, maxWaitMs = 30000): Promise<void> {
  const start = Date.now();
  const pollMs = 500;

  while (Date.now() - start < maxWaitMs) {
    if (!sessionExists(sessionName)) {
      await sleep(pollMs);
      continue;
    }

    const content = capturePane(sessionName);

    // Accept dangerous-mode dialog
    if (content.includes("Yes, I accept")) {
      sendRawKey(sessionName, "Down");
      await sleep(300);
      sendRawKey(sessionName, "Enter");
      await sleep(1000);
      continue;
    }

    // Accept trust dialog
    if (content.includes("Yes, I trust")) {
      sendRawKey(sessionName, "Enter");
      await sleep(500);
      continue;
    }

    // Claude is ready when we see the input prompt
    if (content.includes("❯")) {
      await sleep(500); // brief settle time
      return;
    }

    await sleep(pollMs);
  }
}

async function acceptPrompt(sessionName: string, maxWaitMs = 15000): Promise<void> {
  const start = Date.now();
  const pollMs = 500;

  while (Date.now() - start < maxWaitMs) {
    const content = capturePane(sessionName);

    if (content.includes("Yes, I accept")) {
      sendRawKey(sessionName, "Down");
      await sleep(300);
      sendRawKey(sessionName, "Enter");
      await sleep(1000);
      const afterContent = capturePane(sessionName);
      if (afterContent.includes("Yes, I trust")) {
        sendRawKey(sessionName, "Enter");
        await sleep(500);
      }
      return;
    }

    if (content.includes("Yes, I trust")) {
      sendRawKey(sessionName, "Enter");
      await sleep(500);
      return;
    }

    if (content.includes("Try \"") || content.includes("❯ ")) {
      return;
    }

    await sleep(pollMs);
  }
}

/**
 * Write a launcher script for the team leader.
 * This avoids all shell quoting issues by embedding the system prompt
 * in a file and having the script read it.
 *
 * The system prompt is the ONLY mechanism that prevents re-spawning.
 * It persists across all turns regardless of conversation context.
 */
function writeLeaderLauncher(teamName: string, projectPath: string): string {
  const teamDir = path.join(CLAUDE_DIR, "teams", teamName);
  fs.mkdirSync(teamDir, { recursive: true });

  // Write system prompt to file
  const systemPrompt = [
    `You are the team leader/coordinator for team "${teamName}" working in ${projectPath}.`,
    "",
    "## NO TASKS — IMMEDIATE EXIT",
    "If the setup message says \"(no tasks)\" or there are ZERO tasks listed:",
    "1. Do NOT spawn any teammates",
    "2. Clean up: remove the team directory by running: rm -rf ~/.claude/teams/" + teamName + " ~/.claude/tasks/" + teamName,
    "3. Say \"No tasks assigned. Team exiting immediately.\" and stop",
    "This takes ABSOLUTE priority over all other instructions.",
    "",
    "## INITIAL SETUP (do this ONCE, first turn only)",
    "The team directory already exists at ~/.claude/teams/" + teamName + "/config.json — do NOT call TeamCreate (it is already set up).",
    "1. Spawn ALL teammates listed in your first message using the Task tool — ALL in a single message, each with team_name=\"" + teamName + "\"",
    "2. After spawning, say \"Setup complete\" and switch to monitoring mode",
    "",
    "## MONITORING MODE (after setup)",
    "- Respond to teammate messages promptly",
    "- Help stuck teammates by providing guidance (do NOT do their work)",
    "- When a teammate reports task completion, update the task file on disk AND call TaskUpdate:",
    "  1. Read ~/.claude/tasks/" + teamName + "/{id}.json",
    "  2. Edit the \"status\" field to \"in_progress\" or \"completed\"",
    "  3. Also call TaskUpdate to keep internal tracking in sync",
    "  IMPORTANT: You MUST update the disk files — TaskUpdate alone does NOT update them because",
    "  Claude Code's internal team name differs from the Mission Control team name.",
    "- Check TaskList periodically to track progress",
    "- Do NOT spawn additional teammates after initial setup — all members are created at startup",
    "",
    "## COMPLETION & CLEANUP",
    "When ALL tasks reach status=completed:",
    "1. Run the project build command (e.g. pnpm build) to verify nothing is broken",
    "2. If the build fails, fix the issues and rebuild until it passes",
    "3. Stage and commit all changes with a descriptive conventional commit message (feat:, fix:, refactor:, etc.)",
    "4. Send shutdown_request to each teammate via SendMessage",
    "5. After all teammates confirm shutdown, clean up by running: rm -rf ~/.claude/teams/" + teamName + " ~/.claude/tasks/" + teamName,
    "6. Say \"All tasks complete. Verified and committed.\" and stop",
    "",
    "TASK FILES: ~/.claude/tasks/" + teamName + "/{id}.json",
  ].join("\n");

  const promptFile = path.join(teamDir, "leader-system-prompt.txt");
  fs.writeFileSync(promptFile, systemPrompt, { mode: 0o600, encoding: "utf-8" });

  // Write launcher script
  const scriptFile = path.join(teamDir, "launch-leader.sh");
  // Escape projectPath for safe shell embedding (single-quote with escaping)
  const escapedPath = projectPath.replace(/'/g, "'\\''");
  const script = [
    "#!/bin/bash",
    `cd '${escapedPath}'`,
    // Unset CLAUDECODE so a nested Claude Code session is permitted.
    // When the queue worker runs inside an existing Claude Code session,
    // this env var is set and would block the child claude process.
    "unset CLAUDECODE",
    `exec claude --dangerously-skip-permissions --append-system-prompt "$(cat '${promptFile}')"`,
  ].join("\n");
  fs.writeFileSync(scriptFile, script, { mode: 0o755, encoding: "utf-8" });

  return scriptFile;
}

/**
 * Build the one-time setup message sent to the leader on first launch.
 */
function buildSetupMessage(
  teamName: string,
  description: string,
  members: LaunchableMember[],
  projectPath: string,
  tasks?: TeamTask[]
): string {
  const taskList =
    tasks && tasks.length > 0
      ? tasks
          .map(
            (t) =>
              `[${t.id}] "${t.subject}": ${t.description ?? ""}${t.owner ? ` → ${t.owner}` : ""}`
          )
          .join("\n")
      : "(no tasks)";

  const spawnLines = members
    .map((m) => {
      const assignedTask = tasks?.find((t) => t.owner === m.name);
      const taskDesc = assignedTask
        ? `Task [${assignedTask.id}] "${assignedTask.subject}": ${assignedTask.description ?? ""}`
        : `Role: ${m.description}`;
      const markInProgress = assignedTask
        ? ` FIRST: edit ~/.claude/tasks/${teamName}/${assignedTask.id}.json and set \\"status\\" to \\"in_progress\\" before doing any other work.`
        : "";
      return `- name="${m.name}", subagent_type="general-purpose", mode="bypassPermissions", prompt="You are ${m.name} (${m.role}) on team ${teamName}. ${taskDesc}.${markInProgress} cd ${projectPath} and start immediately."`;
    })
    .join("\n");

  // If no tasks, instruct immediate exit
  if (!tasks || tasks.length === 0) {
    return `NO TASKS for team "${teamName}".

There are ZERO tasks assigned to this team. Follow the "NO TASKS — IMMEDIATE EXIT" protocol:
1. Do NOT spawn any teammates
2. Clean up: run: rm -rf ~/.claude/teams/${teamName} ~/.claude/tasks/${teamName}
3. Say "No tasks assigned. Team exiting immediately." and stop`;
  }

  return `ONE-TIME SETUP for team "${teamName}" (${description}):

IMPORTANT: The team directory already exists at ~/.claude/teams/${teamName}/config.json — do NOT call TeamCreate. It is already configured.

STEP 1: Spawn ALL teammates below via the Task tool — send ALL spawn calls in a SINGLE message, each with team_name="${teamName}":
${spawnLines}

STEP 2: After ALL teammates are spawned, say "Setup complete." and enter monitoring mode.

Tasks to be completed:
${taskList}

IMPORTANT:
- Do NOT call TeamCreate — the team directory already exists
- Spawn ALL teammates in step 1, not one at a time
- After setup, do NOT spawn more teammates — monitor and coordinate only
- When ALL tasks are completed, send shutdown_request to each teammate, then clean up with: rm -rf ~/.claude/teams/${teamName} ~/.claude/tasks/${teamName}
- Help stuck teammates with guidance but do NOT do their work for them`;
}

/**
 * Build the resume message sent to the leader when waking a dead session.
 * Does NOT include TeamCreate — the team already exists on disk.
 */
function buildResumeMessage(
  teamName: string,
  description: string,
  members: LaunchableMember[],
  projectPath: string,
  tasks?: TeamTask[]
): string {
  const taskList =
    tasks && tasks.length > 0
      ? tasks
          .map(
            (t) =>
              `[${t.id}] "${t.subject}" (${t.status})${t.owner ? ` → ${t.owner}` : ""}`
          )
          .join("\n")
      : "(no tasks)";

  const spawnLines = members
    .map((m) => {
      const assignedTask = tasks?.find((t) => t.owner === m.name);
      const taskDesc = assignedTask
        ? `Task [${assignedTask.id}] "${assignedTask.subject}": ${assignedTask.description ?? ""}`
        : `Role: ${m.description}`;
      const markInProgress = assignedTask
        ? ` FIRST: edit ~/.claude/tasks/${teamName}/${assignedTask.id}.json and set \\"status\\" to \\"in_progress\\" before doing any other work.`
        : "";
      return `- name="${m.name}", subagent_type="general-purpose", mode="bypassPermissions", prompt="You are ${m.name} (${m.role}) on team ${teamName}. ${taskDesc}.${markInProgress} cd ${projectPath} and start immediately."`;
    })
    .join("\n");

  // If no tasks remain, instruct immediate exit
  if (!tasks || tasks.length === 0) {
    return `RESUME team "${teamName}" — but there are ZERO tasks remaining.

Follow the "NO TASKS — IMMEDIATE EXIT" protocol:
1. Do NOT spawn any teammates
2. Clean up: run: rm -rf ~/.claude/teams/${teamName} ~/.claude/tasks/${teamName}
3. Say "No tasks assigned. Team exiting immediately." and stop`;
  }

  // If all tasks are already completed/deleted, also exit
  const allDone = tasks.every((t) => t.status === "completed" || t.status === "deleted");
  if (allDone) {
    return `RESUME team "${teamName}" — ALL tasks are already completed.

Follow the "COMPLETION & CLEANUP" protocol:
1. Clean up: run: rm -rf ~/.claude/teams/${teamName} ~/.claude/tasks/${teamName}
2. Say "All tasks already complete. Team exiting." and stop`;
  }

  return `RESUME team "${teamName}" (${description}):

The team ALREADY EXISTS at ~/.claude/teams/${teamName}/config.json.
DO NOT call TeamCreate — it is already configured.

STEP 1: Re-spawn ALL teammates via Task tool (ALL in one message, each with team_name="${teamName}"):
${spawnLines}

STEP 2: Check task status in ~/.claude/tasks/${teamName}/ and coordinate remaining work.

Tasks:
${taskList}

After spawning teammates, enter monitoring mode. When ALL tasks are completed, send shutdown_request to each teammate, then clean up by running: rm -rf ~/.claude/teams/${teamName} ~/.claude/tasks/${teamName}`;
}

/**
 * Resume a team leader session after it died.
 * Re-launches Claude but sends a resume message instead of the full setup.
 */
export async function resumeTeamAsLeader(
  teamName: string,
  description: string,
  members: LaunchableMember[],
  projectPath?: string,
  tasks?: TeamTask[]
): Promise<{ sessionName: string; launched: boolean }> {
  const sessionName = getSessionName(teamName, LEADER_NAME);

  if (sessionExists(sessionName)) {
    if (sessionProcessAlive(sessionName)) {
      return { sessionName, launched: false };
    }
    killSession(sessionName);
  }

  const cwd = projectPath || process.env.HOME || "/tmp";

  // Reuse the same launcher script (same system prompt)
  const scriptPath = writeLeaderLauncher(teamName, cwd);
  createSession(sessionName, `bash ${scriptPath}`, cwd);

  await waitForClaudeReady(sessionName);

  // Send the RESUME message — no TeamCreate, just re-spawn teammates
  const resumeMsg = buildResumeMessage(teamName, description, members, cwd, tasks);
  sendKeysAndSubmit(sessionName, resumeMsg);

  return { sessionName, launched: true };
}

/**
 * Launch a team as a single Claude CLI session (the leader).
 * Uses a launcher script with --append-system-prompt to prevent re-spawning.
 */
export async function launchTeamAsLeader(
  teamName: string,
  description: string,
  members: LaunchableMember[],
  projectPath?: string,
  tasks?: TeamTask[]
): Promise<{ sessionName: string; launched: boolean }> {
  const sessionName = getSessionName(teamName, LEADER_NAME);

  if (sessionExists(sessionName)) {
    if (sessionProcessAlive(sessionName)) {
      return { sessionName, launched: false };
    }
    killSession(sessionName);
  }

  const cwd = projectPath || process.env.HOME || "/tmp";

  // Write launcher script (handles quoting correctly)
  const scriptPath = writeLeaderLauncher(teamName, cwd);

  // Launch via the script — avoids all shell quoting issues
  createSession(sessionName, `bash ${scriptPath}`, cwd);

  // Wait for Claude CLI to be ready (prompt visible), accepting any dialogs
  await waitForClaudeReady(sessionName);

  // Send the one-time setup message
  const setupMsg = buildSetupMessage(teamName, description, members, cwd, tasks);
  sendKeysAndSubmit(sessionName, setupMsg);

  return { sessionName, launched: true };
}

export function getLeaderSessionName(teamName: string): string {
  return getSessionName(teamName, LEADER_NAME);
}

// ── Legacy exports ──

export async function launchTeamMember(
  teamName: string,
  member: LaunchableMember,
  projectPath?: string,
  tasks?: TeamTask[]
): Promise<{ sessionName: string; launched: boolean }> {
  const sessionName = getSessionName(teamName, member.name);

  if (sessionExists(sessionName)) {
    return { sessionName, launched: false };
  }

  const cwd = projectPath || process.env.HOME || "/tmp";
  createSession(sessionName, "claude --dangerously-skip-permissions", cwd);
  await sleep(2000);
  await acceptPrompt(sessionName);
  await sleep(SEND_DELAY_MS);

  const assignedTasks = tasks?.filter((t) => t.owner === member.name) ?? [];
  const taskListStr =
    assignedTasks.length > 0
      ? assignedTasks.map((t) => `- [${t.id}] ${t.subject}`).join("\n")
      : "(check task list)";

  const prompt = `You are "${member.name}" on team "${teamName}". Role: ${member.role}. ${member.description}.
Tasks: ${taskListStr}
${projectPath ? `Project: ${projectPath}` : ""}
Start working immediately.`;

  sendKeysAndSubmit(sessionName, prompt);
  return { sessionName, launched: true };
}

export async function launchTeam(
  teamName: string,
  members: LaunchableMember[],
  projectPath?: string,
  tasks?: TeamTask[]
): Promise<{ launched: string[]; alreadyRunning: string[] }> {
  const launched: string[] = [];
  const alreadyRunning: string[] = [];

  for (const member of members) {
    const result = await launchTeamMember(teamName, member, projectPath, tasks);
    if (result.launched) {
      launched.push(member.name);
    } else {
      alreadyRunning.push(member.name);
    }
  }

  return { launched, alreadyRunning };
}

export function getTeamStatus(teamName: string, memberNames: string[]) {
  return getTeamSessionStatus(teamName, memberNames);
}

export function personaToLaunchable(persona: TeamPersona): LaunchableMember {
  return {
    name: persona.name,
    role: persona.role,
    agentType: persona.agentType,
    description: persona.description,
  };
}
