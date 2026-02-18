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
  backgroundExecution?: boolean;
  /** ID of the QueuedTask that spawned this team (for duplicate prevention) */
  sourceTaskId?: number;
}

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TeamTask {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  owner?: string;
  blockedBy?: string[];
  blocks?: string[];
  activeForm?: string;
  priority?: TaskPriority;
  order?: number;
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
  estimatedCost: number;
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

// ── Skill Types ──────────────────────────────────────────────────────────────

export interface Skill {
  folderName: string;   // directory name under ~/.claude/skills/
  name: string;         // from front matter
  description: string;  // from front matter
  content: string;      // markdown body
}

// ── Knowledge Base Types ──────────────────────────────────────────────────────

export interface KnowledgeBaseEntry {
  id: number;
  path: string;
  name: string;
  tags: string[];
  lastScanned?: string;
  source: "db" | "filesystem" | "both";
}

// ── Settings Types ────────────────────────────────────────────────────────────

export interface ProxyConfig {
  enabled: boolean;
  port: number;
  targetUrl: string;
}

export interface BackgroundExecutionConfig {
  enabled: boolean;
  sleepPreventionMethod: "caffeinate" | "systemd-inhibit" | "auto";
}

export type BackgroundExecutionStatus = "active" | "idle" | "suspended" | "unavailable";

export interface Settings {
  theme?: "dark" | "light" | "system";
  refreshInterval?: number;
  proxyConfig?: ProxyConfig;
  backgroundExecution?: BackgroundExecutionConfig;
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
  /** Links this team to a QueuedTask — enforces one active team per task */
  sourceTaskId?: number;
}

export type TeamCreationStatus = "idle" | "generating" | "reviewing" | "spawning" | "done" | "error";

// ── Background Execution Types ───────────────────────────────────────────────

export interface BackgroundConfig {
  /** Whether this team should auto-wake after system sleep */
  persistent: boolean;
  /** Auto-wake strategy: "immediate" wakes on next health poll, "scheduled" uses a delay */
  wakeStrategy: "immediate" | "scheduled";
  /** Delay in seconds before auto-wake (only for "scheduled" strategy) */
  wakeDelaySeconds: number;
  /** Maximum number of auto-wake attempts before giving up */
  maxWakeRetries: number;
  /** Number of auto-wake attempts so far (resets on manual wake or successful completion) */
  wakeRetryCount: number;
  /** Timestamp of last detected sleep event */
  lastSleepDetected: string | null;
  /** Timestamp of last auto-wake */
  lastAutoWake: string | null;
}

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
  backgroundExecution?: {
    enabled: boolean;
    status: BackgroundExecutionStatus;
    sleepPrevented: boolean;
  };
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

export interface TaskAttachment {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export const ALLOWED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILES_PER_TASK = 5;

export interface QueuedTask {
  id: number;
  goal: string;
  projectPath: string;
  status: QueuedTaskStatus;
  teamName?: string | null;
  priority: number;
  result?: string | null;
  attachments?: TaskAttachment[];
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

// ── Background Execution / Daemon Types ─────────────────────────────────────

export type SleepEventType = "sleep_detected" | "wake_detected";

export interface SleepEvent {
  type: SleepEventType;
  timestamp: string;
}

export interface SessionCheckpointData {
  teamName: string;
  taskStatuses: Record<string, string>; // taskId → status
  paneContent: string;                   // last captured pane output
  leaderAlive: boolean;
  memberStatuses: Record<string, boolean>; // memberName → alive
  projectPath?: string;
}

export interface ResumeAction {
  teamName: string;
  action: "resumed" | "skipped" | "failed";
  reason: string;
  timestamp: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  lastHeartbeat: string | null;
  lastSleepEvent: SleepEvent | null;
  resumeHistory: ResumeAction[];
}

// ── Usage Limits Types ───────────────────────────────────────────────────────

export interface UsageLimits {
  dailyTokens: number | null;
  dailyCost: number | null;
  monthlyTokens: number | null;
  monthlyCost: number | null;
}

export interface UsageSummaryPeriod {
  tokens: number;
  cost: number;
  tokenLimit: number | null;
  costLimit: number | null;
}

export interface UsageSummary {
  daily: UsageSummaryPeriod;
  monthly: UsageSummaryPeriod;
}

// ── API Response Wrapper ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}
