/**
 * Team planning logic — extracted from app/api/teams/smart-create/route.ts
 * so it can be called from both the API route and the queue worker.
 */
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { TeamPlan, TeamPersona } from "@/types";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

const SYSTEM_PROMPT = `You are an expert at designing Claude Code agent teams. Given a goal, output a JSON TeamPlan with:
- teamName: a short kebab-case name (3-5 words, max 40 chars, alphanumeric and dashes only) that summarizes the specific goal — NOT generic names like "fullstack-team" or "api-builders". Examples:
  - "Add user authentication" → "user-auth-impl"
  - "Refactor database queries for performance" → "db-query-optimization"
  - "Build a REST API for inventory management" → "inventory-api"
  - "Fix login page CSS bugs" → "login-css-fixes"
- description: a one-sentence description of what the team does
- personas: an array of team members, each with:
  - name: kebab-case agent name (e.g. "frontend-dev", "backend-dev")
  - role: a short role title (e.g. "Frontend Developer")
  - agentType: one of "general-purpose", "Bash", "Explore", "Plan"
  - description: what this agent is responsible for
- initialTasks: an array of tasks to bootstrap the team, each with:
  - subject: imperative task title (e.g. "Set up project scaffold")
  - description: detailed description of what needs to be done
  - assignTo: (optional) name of the persona to assign this task to

Output ONLY valid JSON, no markdown fences or extra text. Design practical teams of 2-5 members with clear role separation.`;

// ── Template-based plan generator (no API key needed) ────────────────────────

interface TeamTemplate {
  keywords: string[];
  teamName: string;
  description: string;
  personas: TeamPersona[];
  tasks: { subject: string; description: string; assignTo?: string }[];
}

const TEMPLATES: TeamTemplate[] = [
  {
    keywords: ["api", "rest", "backend", "server", "endpoint"],
    teamName: "api-builders",
    description: "A team to design, implement, and test a backend API",
    personas: [
      { name: "architect", role: "Architect", agentType: "Plan", description: "Designs API schema, routes, and data models" },
      { name: "backend-dev", role: "Backend Developer", agentType: "general-purpose", description: "Implements API routes, business logic, and database queries" },
      { name: "tester", role: "QA Engineer", agentType: "Bash", description: "Writes and runs integration tests and validates endpoints" },
    ],
    tasks: [
      { subject: "Design API schema and data models", description: "Define endpoints, request/response shapes, and database schema", assignTo: "architect" },
      { subject: "Implement core API routes", description: "Build the main CRUD endpoints with validation and error handling", assignTo: "backend-dev" },
      { subject: "Write integration tests", description: "Create test suite covering happy paths and edge cases", assignTo: "tester" },
    ],
  },
  {
    keywords: ["frontend", "ui", "react", "next", "dashboard", "page", "component"],
    teamName: "ui-builders",
    description: "A team to build and polish frontend UI components and pages",
    personas: [
      { name: "designer", role: "UI Designer", agentType: "Plan", description: "Plans component hierarchy, layout, and user flows" },
      { name: "frontend-dev", role: "Frontend Developer", agentType: "general-purpose", description: "Implements React components, pages, and client-side logic" },
      { name: "reviewer", role: "Code Reviewer", agentType: "Explore", description: "Reviews code for quality, accessibility, and consistency" },
    ],
    tasks: [
      { subject: "Plan component structure and layout", description: "Design the component tree, page layout, and data flow", assignTo: "designer" },
      { subject: "Implement UI components and pages", description: "Build the components with proper styling and interactivity", assignTo: "frontend-dev" },
      { subject: "Review implementation for quality", description: "Check code quality, accessibility, and design consistency", assignTo: "reviewer" },
    ],
  },
  {
    keywords: ["fullstack", "full-stack", "app", "application", "project", "build"],
    teamName: "fullstack-team",
    description: "A full-stack team to build a complete application",
    personas: [
      { name: "architect", role: "Architect", agentType: "Plan", description: "Designs overall architecture, data models, and technical decisions" },
      { name: "frontend-dev", role: "Frontend Developer", agentType: "general-purpose", description: "Implements UI components, pages, and client-side logic" },
      { name: "backend-dev", role: "Backend Developer", agentType: "general-purpose", description: "Implements API routes, business logic, and database layer" },
      { name: "tester", role: "QA Engineer", agentType: "Bash", description: "Writes and runs integration tests and validates the full application stack" },
    ],
    tasks: [
      { subject: "Design system architecture", description: "Define tech stack, data models, API contracts, and project structure", assignTo: "architect" },
      { subject: "Build backend API layer", description: "Implement API routes, database models, and business logic", assignTo: "backend-dev" },
      { subject: "Build frontend UI", description: "Implement pages, components, and client-side state management", assignTo: "frontend-dev" },
      { subject: "Write end-to-end tests", description: "Create comprehensive tests covering the full application stack", assignTo: "tester" },
    ],
  },
  {
    keywords: ["refactor", "cleanup", "improve", "optimize", "fix", "bug", "debt"],
    teamName: "refactor-squad",
    description: "A team to refactor, optimize, and improve existing code",
    personas: [
      { name: "analyst", role: "Code Analyst", agentType: "Explore", description: "Analyzes the codebase to identify issues and improvement opportunities" },
      { name: "refactorer", role: "Refactoring Engineer", agentType: "general-purpose", description: "Implements refactoring changes while preserving behavior" },
      { name: "tester", role: "QA Engineer", agentType: "Bash", description: "Ensures refactored code passes all tests and maintains correctness" },
    ],
    tasks: [
      { subject: "Analyze codebase for improvement areas", description: "Scan the code for tech debt, code smells, and optimization opportunities", assignTo: "analyst" },
      { subject: "Implement refactoring changes", description: "Refactor identified areas while preserving existing behavior", assignTo: "refactorer" },
      { subject: "Validate with tests", description: "Run existing tests and add coverage for refactored code paths", assignTo: "tester" },
    ],
  },
  {
    keywords: ["test", "testing", "coverage", "qa", "quality"],
    teamName: "qa-team",
    description: "A team focused on testing and quality assurance",
    personas: [
      { name: "test-planner", role: "Test Architect", agentType: "Plan", description: "Designs test strategy, identifies coverage gaps, and plans test suites" },
      { name: "test-writer", role: "Test Engineer", agentType: "general-purpose", description: "Writes unit, integration, and end-to-end tests" },
      { name: "runner", role: "CI Runner", agentType: "Bash", description: "Executes test suites and reports results" },
    ],
    tasks: [
      { subject: "Plan test strategy", description: "Identify testing gaps and design a comprehensive test plan", assignTo: "test-planner" },
      { subject: "Write test cases", description: "Implement tests based on the test plan covering critical paths", assignTo: "test-writer" },
      { subject: "Run full test suite", description: "Execute all tests and generate a coverage report", assignTo: "runner" },
    ],
  },
];

export function toKebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Common filler words to strip when deriving a team name from goal text
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "must",
  "i", "we", "you", "they", "it", "that", "this", "these", "those",
  "my", "our", "your", "make", "create", "implement", "please", "want",
  "like", "get", "set", "use", "using", "into", "about", "some", "all",
]);

/**
 * Derive a meaningful kebab-case name from goal text by stripping
 * filler/stop words and keeping 3-5 descriptive terms.
 */
export function deriveNameFromGoal(goal: string): string {
  const words = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const meaningful = words.slice(0, 5);
  if (meaningful.length === 0) return "";
  return meaningful.join("-").slice(0, 40);
}

/**
 * Ensure a team name is unique by checking active teams and archived teams.
 * Appends -2, -3, etc. if the name already exists.
 */
export function ensureUniqueName(baseName: string): string {
  const existing = new Set<string>();

  // Check active teams
  const teamsPath = path.join(CLAUDE_DIR, "teams");
  if (fs.existsSync(teamsPath)) {
    for (const entry of fs.readdirSync(teamsPath, { withFileTypes: true })) {
      if (entry.isDirectory()) existing.add(entry.name);
    }
  }

  // Check archived teams
  const archivePath = path.join(CLAUDE_DIR, "teams-archive");
  if (fs.existsSync(archivePath)) {
    for (const entry of fs.readdirSync(archivePath, { withFileTypes: true })) {
      if (entry.isDirectory()) existing.add(entry.name);
    }
  }

  if (!existing.has(baseName)) return baseName;

  let suffix = 2;
  while (existing.has(`${baseName}-${suffix}`)) {
    suffix++;
  }
  return `${baseName}-${suffix}`;
}

export function generateLocalPlan(goal: string): TeamPlan {
  const lower = goal.toLowerCase();

  let bestTemplate = TEMPLATES[2]; // default: fullstack
  let bestScore = 0;

  for (const tmpl of TEMPLATES) {
    const score = tmpl.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = tmpl;
    }
  }

  const derivedName = deriveNameFromGoal(goal);
  const rawName = derivedName.length >= 3 ? derivedName : bestTemplate.teamName;
  const teamName = ensureUniqueName(rawName);

  return {
    teamName,
    description: bestTemplate.description,
    personas: bestTemplate.personas,
    initialTasks: bestTemplate.tasks.map((t) => ({
      ...t,
      description: `${t.description}. Goal context: ${goal}`,
    })),
  };
}

export interface PlanResult extends TeamPlan {
  _source: "ai" | "local";
  _fallbackReason?: string;
}

export async function generateTeamPlan(
  goal: string,
  projectPath?: string
): Promise<PlanResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { ...generateLocalPlan(goal), _source: "local" };
  }

  try {
    const client = new Anthropic({ apiKey });
    const userPrompt = projectPath
      ? `Goal: ${goal}\nProject path: ${projectPath}`
      : `Goal: ${goal}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ...generateLocalPlan(goal), _source: "local", _fallbackReason: "no_text_response" };
    }

    const plan = JSON.parse(textBlock.text) as TeamPlan;

    if (!plan.teamName || !plan.personas || !Array.isArray(plan.personas) || plan.personas.length === 0) {
      return { ...generateLocalPlan(goal), _source: "local", _fallbackReason: "invalid_plan" };
    }

    if (!plan.initialTasks || !Array.isArray(plan.initialTasks)) {
      plan.initialTasks = [];
    }

    plan.teamName = ensureUniqueName(plan.teamName);

    return { ...plan, _source: "ai" };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    let reason = "api_error";
    if (errorMsg.includes("credit balance is too low")) reason = "insufficient_credits";
    if (errorMsg.includes("authentication") || errorMsg.includes("invalid x-api-key")) reason = "invalid_key";

    return { ...generateLocalPlan(goal), _source: "local", _fallbackReason: reason };
  }
}
