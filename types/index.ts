// Shared TypeScript types for Mission Control Lin

// ── Agent Team Types ──────────────────────────────────────────────────────────

export interface Teammate {
  name: string;
  agentId: string;
  agentType: string;
  model?: string;
  status?: "active" | "idle" | "offline";
  tmuxSession?: string;
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

// ── Stuck Task Types ─────────────────────────────────────────────────────────

export interface StuckTask extends TeamTask {
  teamName: string;
  blockerType?: "decision_needed" | "missing_info" | "dependency" | "error" | "permission";
  blockerSummary?: string;
  blockerDetails?: string;
  blockerSince?: string;
  blockerFrom?: string;
}

// ── Analytics Types ───────────────────────────────────────────────────────────

export interface DailyEntry {
  date: string;
  totalInput: number;
  totalOutput: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCost: number;
}

export interface ModelEntry {
  model: string;
  totalInput: number;
  totalOutput: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  requests: number;
  avgLatencyMs: number;
  estimatedCost: number;
}

export interface TeamEntry {
  teamName: string;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  requests: number;
}

export interface MemberEntry {
  memberName: string;
  teamName: string;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  requests: number;
  estimatedCost: number;
}

export interface ProxyLog {
  id: number;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
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
  name: string;
  role: string;
  agentType: string;
  description: string;
}

export interface TeamPlan {
  teamName: string;
  description: string;
  personas: TeamPersona[];
  initialTasks: { subject: string; description: string; assignTo?: string }[];
}

export type TeamCreationStatus = "idle" | "generating" | "reviewing" | "spawning" | "done" | "error";

// ── Team Health Types ────────────────────────────────────────────────────────

export type TeamHealthStatus = "alive" | "asleep" | "exited" | "completed";

export interface TeamMemberHealth {
  name: string;
  status: "active" | "idle" | "offline";
  lastSeen: string | null;
}

export interface TeamHealth {
  teamName: string;
  status: TeamHealthStatus;
  lastActivity: string | null;
  memberCount: number;
  pendingTasks: number;
  activeTasks: number;
  staleTasks: TeamTask[];
  memberHealth: TeamMemberHealth[];
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

// ── Task Queue Types ────────────────────────────────────────────────────────

export type QueuedTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface QueuedTask {
  id: number;
  goal: string;
  projectPath: string;
  status: QueuedTaskStatus;
  teamName?: string | null;
  priority: number;
  result?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

// ── Usage API Types ──────────────────────────────────────────────────────────

export interface UsageDailySummary {
  date: string;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  costCents: number;
  source: "api" | "proxy";
}

export interface UsageByModel {
  model: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  source: "api" | "proxy";
}

export interface UsageByWorkspace {
  workspaceId: string | null;
  totalInputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface ClaudeCodeSummary {
  summary: {
    totalSessions: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalCommits: number;
    totalPRs: number;
    avgEditAcceptRate: number;
    avgWriteAcceptRate: number;
  };
  daily: Array<{
    date: string;
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    pullRequests: number;
  }>;
  byUser: Array<{
    actor: string;
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    costCents: number;
  }>;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
  }>;
}

export interface UsageSyncResult {
  usage: { synced: number; fromDate: string; toDate: string } | null;
  cost: { synced: number; fromDate: string; toDate: string } | null;
  claudeCode: { synced: number; fromDate: string; toDate: string } | null;
}

export interface UsageSyncStatus {
  configured: boolean;
  lastSync: {
    usage: string | null;
    cost: string | null;
    claudeCode: string | null;
  };
  keyPrefix: string | null;
}

// ── API Response Wrapper ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}
