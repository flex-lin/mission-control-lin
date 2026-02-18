import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ok, err, serverError } from "@/lib/api-helpers";
import type { TeamPlan, TeamPersona } from "@/types";

const SYSTEM_PROMPT = `You are an expert at designing Claude Code agent teams. Given a goal, output a JSON TeamPlan with:
- teamName: a short kebab-case name for the team (alphanumeric and dashes only)
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
      { name: "tester", role: "QA Engineer", agentType: "Bash", description: "Writes tests and validates the full application stack" },
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

function toKebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function generateLocalPlan(goal: string): TeamPlan {
  const lower = goal.toLowerCase();

  // Find the best matching template
  let bestTemplate = TEMPLATES[2]; // default: fullstack
  let bestScore = 0;

  for (const tmpl of TEMPLATES) {
    const score = tmpl.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = tmpl;
    }
  }

  // Derive a team name from the goal if we can
  const words = goal.trim().split(/\s+/).slice(0, 4);
  const derivedName = toKebabCase(words.join(" "));
  const teamName = derivedName.length >= 3 ? derivedName : bestTemplate.teamName;

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

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let goalText = "";

  try {
    const body = (await req.json()) as { goal?: string; projectPath?: string };
    if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
      return err("goal is required", "VALIDATION_ERROR");
    }

    goalText = body.goal.trim();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // If no API key, use local template-based generation
    if (!apiKey) {
      const plan = generateLocalPlan(goalText);
      return ok({ ...plan, _source: "local" });
    }

    // Use Anthropic API for AI-powered generation
    const client = new Anthropic({ apiKey });

    const userPrompt = body.projectPath
      ? `Goal: ${goalText}\nProject path: ${body.projectPath}`
      : `Goal: ${goalText}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return err("No text response from AI", "AI_ERROR", 500);
    }

    const plan = JSON.parse(textBlock.text) as TeamPlan;

    // Validate required fields
    if (!plan.teamName || !plan.personas || !Array.isArray(plan.personas) || plan.personas.length === 0) {
      return err("AI returned an invalid plan — missing teamName or personas", "AI_ERROR", 500);
    }

    if (!plan.initialTasks || !Array.isArray(plan.initialTasks)) {
      plan.initialTasks = [];
    }

    return ok({ ...plan, _source: "ai" });
  } catch (e) {
    if (e instanceof SyntaxError) {
      return err("AI returned invalid JSON — please try again", "AI_ERROR", 500);
    }

    // Handle Anthropic API errors — fall back to templates gracefully
    const errorMsg = e instanceof Error ? e.message : String(e);

    if (errorMsg.includes("credit balance is too low") && goalText) {
      const fallback = generateLocalPlan(goalText);
      return ok({ ...fallback, _source: "local", _fallbackReason: "insufficient_credits" });
    }
    if (errorMsg.includes("authentication") || errorMsg.includes("invalid x-api-key")) {
      if (goalText) {
        const fallback = generateLocalPlan(goalText);
        return ok({ ...fallback, _source: "local", _fallbackReason: "invalid_key" });
      }
      return err("Invalid ANTHROPIC_API_KEY. Check your key at console.anthropic.com/settings/keys", "AUTH_ERROR", 401);
    }

    return serverError(e);
  }
}
