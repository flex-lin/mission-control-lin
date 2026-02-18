// Shared TypeScript types for Mission Control Lin

// ── Agent Team Types ──────────────────────────────────────────────────────────

export interface Teammate {
  name: string;
  agentId: string;
  agentType: string;
  model?: string;
  status?: "active" | "idle" | "offline";
}

export interface Team {
  name: string;
  members: Teammate[];
  description?: string;
  createdAt?: string;
}

export interface TeamTask {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  owner?: string;
  blockedBy?: string[];
  blocks?: string[];
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

// ── Analytics Types ───────────────────────────────────────────────────────────

export interface ProxyLog {
  id: number;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  teamName?: string;
  memberName?: string;
  endpoint: string;
  latencyMs: number;
  statusCode: number;
}

export interface AnalyticsEntry {
  date: string;
  model: string;
  totalInput: number;
  totalOutput: number;
  estimatedCost: number;
}

// ── Project Types ─────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  path: string;
  name: string;
  lastScanned?: string;
  tags?: string[];
  claudeMd?: string;
}

export interface ProjectContext {
  claudeMd?: string;
  memoryFiles: Record<string, string>;
  fileTree?: string[];
}

// ── Settings Types ────────────────────────────────────────────────────────────

export interface ProxyConfig {
  enabled: boolean;
  port: number;
  targetUrl: string;
}

export interface Settings {
  theme?: "dark" | "light" | "system";
  refreshInterval?: number;
  proxyConfig?: ProxyConfig;
  experimental?: Record<string, boolean>;
  indexedProjects?: string[];
}

// ── Activity Feed Types ───────────────────────────────────────────────────────

export type ActivityEventType =
  | "task_created"
  | "task_updated"
  | "task_completed"
  | "team_created"
  | "message_sent"
  | "build_started"
  | "build_completed"
  | "proxy_request";

export interface ActivityEvent {
  timestamp: string;
  type: ActivityEventType;
  team?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

// ── Smart Team Creation Types ────────────────────────────────────────────────

export interface TeamPersona {
  name: string
  role: string
  agentType: string
  description: string
}

export interface TeamPlan {
  teamName: string
  description: string
  personas: TeamPersona[]
  initialTasks: { subject: string; description: string; assignTo?: string }[]
}

export type TeamCreationStatus = "idle" | "generating" | "reviewing" | "spawning" | "done" | "error"

// ── Team Health Types ────────────────────────────────────────────────────────

export type TeamHealthStatus = "alive" | "asleep" | "exited";

export interface TeamHealth {
  teamName: string;
  status: TeamHealthStatus;
  lastActivity: string | null;
  memberCount: number;
  pendingTasks: number;
  activeTasks: number;
}

export interface WakeRequest {
  taskId?: string;
  message?: string;
}

export interface WakeResponse {
  teamName: string;
  woken: boolean;
  message: string;
}

// ── API Response Wrapper ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}
