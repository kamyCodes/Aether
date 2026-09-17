/** Shared types for backend & frontend. */

export interface OmniModel {
  id: string;
  object?: string;
  owned_by?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  root: string;
  indexed: boolean;
  git: boolean;
  fileCount: number;
}

export type FileNodeType = 'file' | 'dir';

export interface FileNode {
  name: string;
  path: string; // workspace-relative, '/' separators
  type: FileNodeType;
  children?: FileNode[];
  size?: number;
}

export interface FileChangeEvent {
  workspaceId: string;
  path: string;
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
}

// ---------- Diff / proposals ----------

export type DiffHunk = {
  header: string;
  lines: { type: 'ctx' | 'add' | 'del'; old: number; new: number; text: string }[];
};

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
}

export interface ChangeProposal {
  id: string;
  taskId?: string;
  title: string;
  description?: string;
  files: FileDiff[];
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
}

// ---------- Agent ----------

export type AgentMode = 'agent' | 'ask' | 'plan';

/** Run state machine: queued → planning → (awaiting_approval) → running
 *  (executing) → verifying → completed (done) | failed | cancelled. */
export type AgentTaskStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'verifying'
  | 'awaiting_permission'
  | 'awaiting_question'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ---------- Artifacts (Antigravity-style) ----------

/** One concrete step in the agent's task plan — the thing the user watches. */
export interface TaskStep {
  id: string;
  label: string;
  detail?: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
}

/** A comment pinned to a line of the Implementation Plan. */
export interface PlanComment {
  line: number;
  text: string;
  ts: number;
}

/** Implementation Plan artifact — produced by Plan mode before execution. */
export interface ImplementationPlan {
  id: string;
  taskId: string;
  /** Raw markdown of the plan (rendered in UI; comments pin to line numbers). */
  raw: string;
  /** Extracted file paths the plan intends to touch. */
  files: string[];
  status: 'draft' | 'pending_approval' | 'approved' | 'revised' | 'rejected';
  comments: PlanComment[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** What changed in one file during a run — drives inline diff artifacts. */
export interface DiffArtifact {
  id: string;
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
  ts: number;
}

/** Verification entry: a command the agent ran to prove its work. */
export interface VerificationEntry {
  command: string;
  output: string;
  ok: boolean;
  ts: number;
}

/**
 * Why a reply is delayed/stalled — surfaced as a subtle status line under the
 * chat, never as a bubble (per chat-UX spec).
 */
export interface StreamStatus {
  kind: 'thinking' | 'retrying' | 'degraded';
  reason: string;
  /** Retry attempt, e.g. 1 of 3. */
  attempt?: number;
  maxAttempts?: number;
  /** Task the status belongs to — lets the UI scope stall notices to the
   *  workspace/chat actually showing that run instead of globally. */
  taskId?: string;
  ts: number;
}

/** Walkthrough artifact — replaces the closing chat message on completion. */
export interface Walkthrough {
  title: string;
  summary: string;
  changes: { path: string; status: string; additions: number; deletions: number }[];
  verification: VerificationEntry[];
  completedAt: number;
}

export interface ActivityItem {
  id: string;
  taskId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  icon?: string;
  label: string;
  detail?: string;
  tool?: string;
  filePath?: string;
  command?: string;
  result?: string;
  error?: string;
  diffId?: string;
  ts: number;
}

export interface AgentQuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface AgentQuestion {
  id: string;
  taskId: string;
  title: string;
  kind: 'choice' | 'yesno' | 'text' | 'confirm';
  options?: AgentQuestionOption[];
  answer?: string;
  ts: number;
}

export interface PermissionRequest {
  id: string;
  taskId?: string;
  kind: 'read' | 'write' | 'delete' | 'command' | 'install' | 'network' | 'git' | 'env' | 'deploy';
  title: string;
  detail: string;
  command?: string;
  path?: string;
  ts: number;
  decision?: 'allow' | 'always' | 'deny';
}

export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  mode: AgentMode;
  status: AgentTaskStatus;
  model?: string;
  createdAt: number;
  updatedAt: number;
  workspaceId: string;
  activity: ActivityItem[];
  checkpointId?: string;
  error?: string;
  filesChanged: string[];
  /** Task List artifact — agent-generated concrete steps, watched by the user. */
  steps: TaskStep[];
  /** Implementation Plan artifact (plan mode, or agent mode running from a plan). */
  plan?: ImplementationPlan;
  /** Per-file diffs captured during the run, rendered inline. */
  diffs?: DiffArtifact[];
  /** Walkthrough artifact on completion. */
  walkthrough?: Walkthrough;
  /** Plan this task was spawned from, when created via plan approval. */
  fromPlanId?: string;
}

// ---------- Autonomy ----------

export type AutonomyMode = 'secure' | 'review' | 'agent' | 'custom';

export interface AutonomySettings {
  mode: AutonomyMode;
  /** Custom mode: command prefixes always allowed without prompting. */
  allowPrefixes: string[];
  /** Custom mode: command prefixes always denied. */
  denyPrefixes: string[];
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts: number;
  taskId?: string;
}

// ---------- Agent memory ----------

export interface MemoryEntry {
  id: string;
  text: string;
  source: 'agent' | 'user';
  ts: number;
}

// ---------- Persisted task history ----------

export interface PersistedTask {
  task: AgentTask;
  messages: AgentMessage[];
  savedAt: number;
}

/** Name of a skill invoked with `/skill-name` in the composer. */
export interface SkillInvocation {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  attachments?: { name: string; type: string; dataUrl?: string; text?: string }[];
  model?: string;
  taskId?: string;
  error?: boolean;
  pending?: boolean;
  /** Explicitly-invoked skills, e.g. the `/ui-design` slash mention. */
  skillInvocation?: SkillInvocation;
}

// ---------- Context ----------

export interface ContextReport {
  contextWindow: number;
  used: number;
  exact: boolean; // false = estimated
  breakdown: { system: number; files: number; chat: number; tools: number; skills: number };
  files: { path: string; tokens: number; pinned: boolean }[];
  /** Context % at which the thread auto-compacts (summarizes older history). */
  compactAtPct?: number;
  /** Cumulative provider-reported usage across the current thread transcript. */
  threadUsage?: {
    input: number;
    cachedInput: number; // prompt-cache hits (already included in input)
    output: number;
    calls: number;
  };
}

// ---------- Skills ----------

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  builtin?: boolean;
  scope: 'global' | 'project';
  instructions: string;
  rules: string[];
  examples?: string[];
  resources?: { name: string; content: string }[];
  tools?: string[];
  priority: number;
  /** Skill-pack provenance (set by importPack, surfaced in the manager UI). */
  packCategory?: string;
  packTags?: string[];
}

// ---------- Permissions rules ----------

export interface PermissionRule {
  id: string;
  kind: PermissionRequest['kind'];
  pattern: string; // glob or prefix, '*' = all
  decision: 'allow' | 'deny';
  createdAt: number;
}

// ---------- Checkpoints ----------

export interface Checkpoint {
  id: string;
  workspaceId: string;
  label: string;
  createdAt: number;
  files: { path: string; content: string | null; hash: string }[];
  auto: boolean;
}

// ---------- Terminal ----------

export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
}

// ---------- Preview ----------

export interface PreviewTarget {
  id: string;
  label: string;
  url: string;
  kind: 'static' | 'dev-server';
}

// ---------- Settings ----------

export interface OmniSettings {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  streaming: boolean;
  fallbackModel: string;
  modelPrefs: {
    chat?: string;
    coding?: string;
    planning?: string;
    vision?: string;
    debugging?: string;
    testing?: string;
  };
}

export interface UiSettings {
  theme: 'dark' | 'light' | 'oled';
  accent: string;
  fontSize: number;
  uiScale: 'compact' | 'comfortable';
  font: string;
}

export interface AppSettings {
  omni: OmniSettings;
  ui: UiSettings;
  agent: { autonomy: AutonomySettings };
}

// ---------- Models ----------

export interface ModelInfo extends OmniModel {
  contextWindow?: number;
  vision?: boolean;
  reasoner?: boolean;
  /** Raw type field from the gateway (embedding/rerank/audio/... excluded from pickers). */
  type?: string;
  /** Present on richer catalogs (e.g. theoldllm 🆓 marker). */
  name?: string;
  /** True when inferred free (id suffix, free provider, or free marker). */
  free?: boolean;
  /** True when a combo routing alias (auto/*, owned_by "combo"). */
  routingAlias?: boolean;
}

export type TaskCategory = 'coding' | 'debugging' | 'testing' | 'planning' | 'chat' | 'vision';

/** Result of automatic task-based model routing. */
export interface RoutingDecision {
  model: string;
  category: TaskCategory;
  /** Human-readable chain: why this model was chosen. */
  reason: string;
  candidates: string[];
}

export interface UsageEvent {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd?: number;
  kind: 'chat' | 'agent';
  ts: number;
}

export interface Analytics {
  tokensIn: number;
  tokensOut: number;
  calls: number;
  errors: number;
  byModel: Record<string, { in: number; out: number; calls: number }>;
}
