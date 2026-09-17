import { create } from 'zustand';
import type {
  ActivityItem,
  AgentQuestion,
  AgentTask,
  AppSettings,
  ChatMessage,
  ChangeProposal,
  ContextReport,
  FileNode,
  MemoryEntry,
  ModelInfo,
  PermissionRequest,
  Skill,
  StreamStatus,
  TerminalInfo,
  UsageEvent,
  WorkspaceInfo,
} from '../../shared/types';
import { get, post, put, del } from './api';

export interface OpenTab {
  id: string;
  kind: 'file' | 'diff' | 'settings' | 'search' | 'map' | 'git' | 'debug' | 'skills' | 'review';
  title: string;
  path?: string;
  pinned?: boolean;
  preview?: boolean;
}

/** One changed file in the Review pending changes view. */
export interface ReviewFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: import('../../shared/types').DiffHunk[];
}

export interface ReviewData {
  branch: string;
  files: ReviewFile[];
  /** Number of editor buffers with unsaved changes (merged into the view). */
  dirtyCount: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  /** Workspace this thread belongs to — switching workspaces shows that
   *  workspace's own threads, never another project's conversation. */
  workspaceId: string | null;
}

/** Wire shape of GET/PUT /workspaces/:id/chats (server/chats.ts). */
interface PersistedWorkspaceChats {
  workspaceId: string;
  activeChatId: string | null;
  chatTaskId: string | null;
  activeTaskId: string | null;
  sessions: { id: string; title: string; createdAt: number; messages: ChatMessage[] }[];
}

/** Persist one workspace's chat state (debounced — bursts coalesce server-side). */
const chatPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Abort controller for the in-flight ask-mode fetch — stopChat() aborts the
 *  HTTP request and its SSE reader mid-stream. One at a time by design. */
let chatAbort: AbortController | null = null;
function persistChatsFor(workspaceId: string) {
  if (!workspaceId) return;
  const prev = chatPersistTimers.get(workspaceId);
  if (prev) clearTimeout(prev);
  chatPersistTimers.set(
    workspaceId,
    setTimeout(() => {
      chatPersistTimers.delete(workspaceId);
      const st = useStore.getState();
      const sessions = st.chatSessions.filter((s) => s.workspaceId === workspaceId);
      void put(`/workspaces/${workspaceId}/chats`, {
        workspaceId,
        activeChatId: st.activeChatId ?? null,
        chatTaskId: st.chatTaskByWs[workspaceId] ?? null,
        activeTaskId: st.activeTaskByWs[workspaceId] ?? null,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          messages: s.messages,
        })),
      }).catch(() => {
        /* offline / workspace gone — retried on the next change */
      });
    }, 800),
  );
}

export interface Toast {
  id: string;
  message: string;
  undo?: () => void;
  ts: number;
}

/**
 * Parse a leading `/skill-id` or `/skill-id more text` out of the composer
 * input. Also accepts the natural-language form `/skill ui-design …` where
 * the literal word "skill" precedes the id.
 */
export function extractSkillInvocation(input: string): { rest: string; skillId: string } | null {
  const m = input.match(/^\/(?:skill\s+)?([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const first = m[1].toLowerCase();
  const second = (m[2] ?? '').trim();
  // `/skill ui-design` → the id is the SECOND word.
  if (first === 'skill' && second) {
    const inner = second.match(/^([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
    if (inner) return { skillId: inner[1], rest: (inner[2] ?? '').trim() };
  }
  // `/skill` alone with no id → not an invocation.
  if (first === 'skill' && !second) return null;
  // Natural trailing-keyword form: `/ui-design skill` → drop the literal word.
  const rest = second.replace(/\s*skill$/i, '').trim();
  return { skillId: m[1], rest };
}

/**
 * Capture of a deleted entry kept in memory so the toast's Undo can restore
 * it. For files: content. For folders: the flat list of contained files.
 */
interface DeletedCapture {
  workspaceId: string;
  path: string;
  isDir: boolean;
  files: { path: string; content: string }[];
}

interface CatalogEntry {
  id: string;
  owned_by?: string;
  free?: boolean;
  routingAlias?: boolean;
  provider: string;
  working: boolean;
}

interface AppState {
  // workspace
  workspaces: WorkspaceInfo[];
  workspaceId: string | null;
  tree: FileNode | null;
  // editor
  tabs: OpenTab[];
  activeTabId: string | null;
  fileContents: Record<string, string>;
  dirtyFiles: Set<string> | string[];
  // omni
  omniConnected: boolean;
  omniError: string | null;
  models: ModelInfo[];
  /** Full catalog (all providers) for the "show all models" picker toggle. */
  allModels: CatalogEntry[] | null;
  showAllModels: boolean;
  selectedModel: string;
  settings: AppSettings | null;
  // chat
  chatSessions: ChatSession[];
  activeChatId: string | null;
  chatStreaming: boolean;
  chatModel: string;
  /** Subtle under-chat status (thinking / retrying / degraded) — never a bubble. */
  chatStatus: StreamStatus | null;
  /** Ids of skills explicitly invoked via `/skill-name` in the current turn. */
  invokedSkillIds: string[];
  // agent
  tasks: AgentTask[];
  /** Last-selected task per workspace — the task list is scoped to the
   *  workspace on screen, so one project's run never leaks into another. */
  activeTaskByWs: Record<string, string>;
  /** Task bound to the current chat thread, per workspace. */
  chatTaskByWs: Record<string, string>;
  agentStream: Record<string, string>;
  /** Composer mode shared by the unified composer (Agent / Ask / Plan). */
  composerMode: 'agent' | 'ask' | 'plan';
  /** Pre-fill for the composer textarea (Ask-Agent-from-terminal, etc.). */
  composerPrefill: string;
  // agent memory
  memory: MemoryEntry[];
  // toasts
  toasts: Toast[];
  // infra
  permissions: PermissionRequest[];
  questions: AgentQuestion[];
  proposals: ChangeProposal[];
  activity: ActivityItem[];
  usage: UsageEvent[];
  context: ContextReport | null;
  /** Live health snapshot from the backend monitor (WS-pushed on change). */
  modelHealth: Record<
    string,
    {
      status: string;
      lastChecked: number;
      lastLatencyMs?: number;
      lastError?: string;
      consecutiveFailures?: number;
      cooldownUntil?: number;
    }
  >;
  skills: Skill[];
  terminals: TerminalInfo[];
  wsStatus: 'connecting' | 'open' | 'closed';
  /** Per-file git working-tree status for the current workspace ('M' modified, 'U' untracked/added, 'D' deleted). Empty when not a repo. */
  gitStatuses: Record<string, 'M' | 'U' | 'D'>;
  /** Current git branch (display only, from the git/status call already made for tree badges). */
  gitBranch: string;

  // actions
  init: () => Promise<void>;
  loadWorkspaces: () => Promise<void>;
  addWorkspace: (root: string) => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;
  closeWorkspace: (id: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openFile: (path: string, preview?: boolean) => Promise<void>;
  openTab: (tab: Omit<OpenTab, 'id'> & { id?: string }) => void;
  /** Load the review-pending-changes payload (git diffs + dirty buffers). */
  loadReview: () => Promise<ReviewData>;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;
  setFileContent: (path: string, content: string) => void;
  loadFile: (path: string) => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  renameEntry: (from: string, to: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  showToast: (message: string, undo?: () => void) => void;
  dismissToast: (id: string) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (s: AppSettings) => Promise<void>;
  refreshModels: () => Promise<void>;
  toggleShowAllModels: (on: boolean) => Promise<void>;
  newChat: () => void;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  sendChat: (content: string, attachments?: ChatMessage['attachments']) => Promise<void>;
  /** User-requested stop of the ask-mode stream: aborts the fetch, keeps
   *  whatever partial text already arrived, and disables the auto-retry. */
  stopChat: () => void;
  startTask: (prompt: string, mode: 'agent' | 'ask' | 'plan') => Promise<void>;
  loadTasks: () => Promise<void>;
  loadMemory: () => Promise<void>;
  addMemory: (text: string) => Promise<void>;
  removeMemory: (id: string) => Promise<void>;
  clearMemory: () => Promise<void>;
  selectTask: (id: string | null) => void;
  // (per-workspace task bindings replaced the old global activeTaskId)
  taskAction: (id: string, action: 'pause' | 'resume' | 'cancel') => Promise<void>;
  approvePlan: (taskId: string, model?: string) => Promise<void>;
  rejectPlan: (taskId: string) => Promise<void>;
  commentPlan: (taskId: string, comments: { line: number; text: string }[]) => Promise<void>;
  answerQuestion: (id: string, answer: string) => Promise<void>;
  decidePermission: (id: string, decision: 'allow' | 'always' | 'deny') => Promise<void>;
  refreshContext: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  toggleSkill: (id: string) => Promise<void>;
  saveSkill: (s: Skill) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  wipeData: (keep: string[]) => Promise<{ removed: string[]; errors: string[]; dataDir: string }>;
  setWsStatus: (s: AppState['wsStatus']) => void;
  handleWs: (type: string, payload: unknown) => void;
  acceptProposal: (id: string) => Promise<void>;
  rejectProposal: (id: string) => Promise<void>;
}

let ws: WebSocket | null = null;

// Coalesce fs:change bursts (git ops, folder deletes) into one tree refresh.
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTreeRefresh() {
  if (treeRefreshTimer) return;
  treeRefreshTimer = setTimeout(() => {
    treeRefreshTimer = null;
    const st = useStore.getState();
    if (st.workspaceId) void st.refreshTree();
  }, 250);
}
export function getWs(): WebSocket | null {
  return ws;
}
export function connectWs(store: {
  setWsStatus: (s: 'connecting' | 'open' | 'closed') => void;
  handleWs: (type: string, payload: unknown) => void;
}) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  (window as unknown as { __omniws?: WebSocket }).__omniws = ws;
  store.setWsStatus('connecting');
  ws.onopen = () => {
    store.setWsStatus('open');
    // Self-heal: the backend may have (re)started after boot. If the model
    // catalog never loaded (or was marked disconnected), re-fetch now —
    // otherwise the composer pickers stay empty for the whole session.
    const st = useStore.getState();
    if (!st.models.length || !st.omniConnected) void st.refreshModels();
    // Re-sync tasks: task state observed before a backend restart is a
    // ghost otherwise — the old socket delivered 'running' that the new
    // process will never finalize, and the status bar shows it forever.
    void st.loadTasks();
    void st.refreshHealth();
  };
  ws.onclose = () => {
    store.setWsStatus('closed');
    setTimeout(() => connectWs(store), 2000);
  };
  ws.onmessage = (ev) => {
    try {
      const { type, payload } = JSON.parse(ev.data);
      store.handleWs(type, payload);
    } catch {
      /* ignore */
    }
  };
}
export function wsSend(type: string, payload: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
}

export const useStore = create<AppState>((setState, getState) => ({
  workspaces: [],
  workspaceId: null,
  tree: null,
  tabs: [],
  activeTabId: null,
  fileContents: {},
  dirtyFiles: [],
  omniConnected: false,
  omniError: null,
  models: [],
  allModels: null,
  showAllModels: false,
  selectedModel: '',
  settings: null,
  chatSessions: [],
  activeChatId: null,
  chatStreaming: false,
  chatModel: '',
  chatStatus: null,
  invokedSkillIds: [],
  composerMode: 'agent',
  composerPrefill: '',
  tasks: [],
  activeTaskByWs: {},
  chatTaskByWs: {},
  agentStream: {},
  memory: [],
  toasts: [],
  permissions: [],
  questions: [],
  proposals: [],
  activity: [],
  usage: [],
  context: null,
  modelHealth: {},
  gitStatuses: {},
  gitBranch: '',
  skills: [],
  terminals: [],
  wsStatus: 'connecting',

  setWsStatus: (s) => setState({ wsStatus: s }),

  handleWs: (type, payload) => {
    const st = getState();
    switch (type) {
      case 'activity':
        setState({ activity: [payload as ActivityItem, ...st.activity].slice(0, 300) });
        break;
      case 'task': {
        const t = payload as AgentTask;
        const tasks = st.tasks.filter((x) => x.id !== t.id);
        tasks.unshift(t);
        // When the task reaches a terminal state, close out any pending
        // assistant bubble so it stops showing the typing dots.
        const terminal =
          t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled';
        // Auto-dismiss stale proposals: once the proposing task hits a
        // terminal state, an un-acted-on pending proposal can no longer be
        // applied to anything meaningful — sweep it instead of letting the
        // cards pile up in the feed. Proposals with no taskId (rare, manual)
        // are left for the 30-minute freshness filter in AgentChat.
        const staleProposalIds = new Set(
          terminal
            ? st.proposals
                .filter((p) => p.status === 'pending' && p.taskId === t.id)
                .map((p) => p.id)
            : [],
        );
        setState({
          tasks: tasks.slice(0, 100),
          ...(staleProposalIds.size
            ? { proposals: st.proposals.filter((p) => !staleProposalIds.has(p.id)) }
            : {}),
          // Finalize the pending assistant bubble of the run's OWN thread —
          // bubbles carry the taskId, so the answer settles in the chat that
          // spawned the run even if the user has switched workspace since.
          // Untagged (legacy) bubbles finalize as before.
          ...(terminal
            ? {
                chatSessions: st.chatSessions.map((s) => ({
                  ...s,
                  messages: s.messages.map((msg) =>
                    msg.pending &&
                    msg.role === 'assistant' &&
                    (!msg.taskId || msg.taskId === t.id)
                      ? {
                          ...msg,
                          pending: false,
                          content:
                            msg.content ||
                            (t.status === 'failed'
                              ? '⚠ Task failed — see Settings → Logs for details.'
                              : t.status === 'cancelled'
                                ? 'Task ended.'
                                : '(no response)'),
                          error: t.status === 'failed',
                        }
                      : msg,
                  ),
                })),
              }
            : {}),
        });
        break;
      }
      case 'permission':
        setState({
          permissions: [
            payload as PermissionRequest,
            ...st.permissions.filter((p) => p.id !== (payload as PermissionRequest).id),
          ],
        });
        break;
      case 'question': {
        const q = payload as AgentQuestion;
        setState({ questions: [q, ...st.questions.filter((x) => x.id !== q.id)] });
        break;
      }
      case 'proposal':
        setState({
          proposals: [
            payload as ChangeProposal,
            ...st.proposals.filter((p) => p.id !== (payload as ChangeProposal).id),
          ],
        });
        break;
      case 'usage':
        setState({ usage: [payload as UsageEvent, ...st.usage].slice(0, 100) });
        break;
      case 'fs:change': {
        const ev = payload as { workspaceId: string; path: string; type: string };
        if (ev.workspaceId === st.workspaceId) scheduleTreeRefresh();
        // drop cached content so editors reload
        if (st.fileContents[ev.path] !== undefined && ev.type !== 'add') {
          void st.loadFile(ev.path);
        }
        // close tabs whose file no longer exists
        if (ev.type === 'unlink') {
          const victim = st.tabs.find((t) => t.path === ev.path);
          if (victim) st.closeTab(victim.id);
        }
        break;
      }
      case 'memory':
        void getState().loadMemory();
        break;
      case 'health:models': {
        // Pushed by the backend monitor on every probe/outcome change —
        // drives the live cooldown countdown in Settings → Models health.
        const hs = payload as { models?: Record<string, never> };
        if (hs?.models) setState({ modelHealth: hs.models as never });
        break;
      }
      case 'agent:delta': {
        const d = payload as { taskId: string; delta: string };
        setState({
          agentStream: {
            ...st.agentStream,
            [d.taskId]: (st.agentStream[d.taskId] ?? '') + d.delta,
          },
        });
        break;
      }
      case 'agent:status': {
        const s = payload as (StreamStatus & { taskId?: string }) | null;
        // Scope stall/retry notices to the workspace actually showing the
        // run — a retry in project B must not surface in project A's chat.
        if (s?.taskId) {
          const taskWs = st.tasks.find((t) => t.id === s.taskId)?.workspaceId;
          if (taskWs && st.workspaceId && taskWs !== st.workspaceId) break;
        }
        setState({ chatStatus: s });
        break;
      }
      case 'agent:message': {
        const m = payload as { taskId: string; content: string };
        setState((s2) => ({
          agentStream: { ...s2.agentStream, [m.taskId]: '' },
          tasks: s2.tasks.map((t) => (t.id === m.taskId ? { ...t } : t)),
          // The final answer lands in the thread that OWNS the run (matched
          // by the pending bubble's taskId) — never in whichever chat happens
          // to be active, which could belong to a different workspace.
          chatSessions: s2.chatSessions.map((s) =>
            s.messages.some((msg) => msg.taskId === m.taskId && msg.pending)
              ? {
                  ...s,
                  messages: s.messages.map((msg) =>
                    msg.pending && msg.taskId === m.taskId ? { ...msg, content: m.content } : msg,
                  ),
                }
              : s,
          ),
        }));
        break;
      }
    }
  },

  init: async () => {
    await getState().loadSettings();
    await getState().loadWorkspaces();
    await getState().loadTasks();
    void getState().loadMemory();
    void getState().refreshModels();
    void getState().refreshSkills();
    void getState().refreshContext();
    void getState().refreshHealth();
    connectWs({ setWsStatus: getState().setWsStatus, handleWs: getState().handleWs });
  },

  loadWorkspaces: async () => {
    const workspaces = await get<WorkspaceInfo[]>('/workspaces');
    setState({ workspaces });
    if (!getState().workspaceId && workspaces.length)
      await getState().selectWorkspace(workspaces[0].id);
  },

  addWorkspace: async (root) => {
    const ws2 = await post<WorkspaceInfo>('/workspaces', { root });
    setState({ workspaces: [...getState().workspaces, ws2] });
    await getState().selectWorkspace(ws2.id);
  },

  // Stop watching a folder and drop it from the registry. Files on disk are
  // never touched; only the session's association with the folder ends.
  // The closed workspace's chat threads and task bindings end with it.
  closeWorkspace: async (id) => {
    await del(`/workspaces/${id}`);
    // The workspace's persisted threads go with it (server drops its file).
    const t = chatPersistTimers.get(id);
    if (t) clearTimeout(t);
    chatPersistTimers.delete(id);
    const st = getState();
    const rest = st.workspaces.filter((w) => w.id !== id);
    const chatSessions = st.chatSessions.filter((s) => s.workspaceId !== id);
    const activeTaskByWs = { ...st.activeTaskByWs };
    const chatTaskByWs = { ...st.chatTaskByWs };
    delete activeTaskByWs[id];
    delete chatTaskByWs[id];
    const wasActive = st.workspaceId === id;
    setState({
      workspaces: rest,
      chatSessions,
      activeTaskByWs,
      chatTaskByWs,
      ...(wasActive
        ? {
            workspaceId: null,
            tree: null,
            tabs: [],
            activeTabId: null,
            activeChatId: null,
            gitStatuses: {},
            gitBranch: '',
          }
        : {}),
    });
    if (wasActive && rest.length) await getState().selectWorkspace(rest[0].id);
  },

  selectWorkspace: async (id) => {
    const st = getState();
    // Each workspace gets its own session: switch the chat panel to this
    // workspace's most recent thread (or an empty one) and rebind its task.
    const wsChats = st.chatSessions.filter((s) => s.workspaceId === id);
    const nextChat = wsChats[0];
    const boundTask = nextChat
      ? ([...nextChat.messages].reverse().find((m) => m.taskId)?.taskId ?? null)
      : null;
    setState({
      workspaceId: id,
      tree: null,
      tabs: [],
      activeTabId: null,
      activeChatId: nextChat?.id ?? null,
      chatStatus: null, // never carry the previous workspace's stall notice over
      ...(boundTask ? { chatTaskByWs: { ...st.chatTaskByWs, [id]: boundTask } } : {}),
    });
    await getState().refreshTree();
    void getState().loadMemory();
    void getState().refreshSkills(); // re-scope the skills panel to this project
    void post(`/workspaces/${id}/index`, { incremental: false }).then(() =>
      getState().refreshContext(),
    );
    // Hydrate persisted threads from disk (after an app restart the store
    // starts empty for this workspace). Server truth merges under local
    // state — a hot session in memory always wins over the stored mirror.
    void get<PersistedWorkspaceChats>(`/workspaces/${id}/chats`)
      .then((saved) => {
        if (!saved?.sessions?.length || getState().workspaceId !== id) return;
        const cur = getState();
        if (cur.chatSessions.some((s) => s.workspaceId === id)) return; // live session present
        const sessions: ChatSession[] = saved.sessions.map((s) => ({
          ...s,
          workspaceId: id,
        }));
        const active =
          saved.activeChatId && sessions.some((s) => s.id === saved.activeChatId)
            ? saved.activeChatId
            : sessions[0].id;
        setState({
          chatSessions: [...sessions, ...cur.chatSessions],
          activeChatId: cur.activeChatId ?? active,
          chatTaskByWs: { ...cur.chatTaskByWs, [id]: cur.chatTaskByWs[id] || saved.chatTaskId || '' },
          activeTaskByWs: {
            ...cur.activeTaskByWs,
            ...(saved.activeTaskId && !cur.activeTaskByWs[id]
              ? { [id]: saved.activeTaskId }
              : {}),
          },
        });
      })
      .catch(() => {
        /* no persisted threads yet */
      });
  },

  refreshTree: async () => {
    const id = getState().workspaceId;
    if (!id) return;
    const tree = await get<FileNode>(`/workspaces/${id}/tree`);
    setState({ tree });
    // Git badges for the tree: refresh alongside the tree (cheap; server
    // returns empty when the workspace isn't a repo). Fire-and-forget so a
    // slow statusMatrix never delays the tree render.
    void get<{ files: { path: string; status: string }[]; current?: string }>(
      `/workspaces/${id}/git/status`,
    )
      .then((gs) => {
        const map: Record<string, 'M' | 'U' | 'D'> = {};
        for (const f of gs.files) {
          if (f.status === 'added') map[f.path] = 'U';
          else if (f.status === 'deleted') map[f.path] = 'D';
          else if (f.status === 'modified') map[f.path] = 'M';
        }
        useStore.setState({ gitStatuses: map, gitBranch: gs.current ?? '' });
      })
      .catch(() => useStore.setState({ gitStatuses: {}, gitBranch: '' }));
  },

  openFile: async (path, preview) => {
    const st = getState();
    const existing = st.tabs.find((t) => t.kind === 'file' && t.path === path);
    if (existing) {
      setState({
        activeTabId: existing.id,
        tabs: st.tabs.map((t) =>
          t.id === existing.id ? { ...t, preview: preview ?? t.preview } : t,
        ),
      });
      return;
    }
    await st.loadFile(path);
    const tab: OpenTab = {
      id: `file:${path}`,
      kind: 'file',
      title: path.split('/').pop() ?? path,
      path,
      preview,
    };
    setState({ tabs: [...st.tabs, tab], activeTabId: tab.id });
  },

  openTab: (tab) => {
    const st = getState();
    const id = tab.id ?? `${tab.kind}:${tab.path ?? ''}`;
    const existing = st.tabs.find((t) => t.id === id);
    if (existing) {
      setState({ activeTabId: id });
      return;
    }
    setState({ tabs: [...st.tabs, { ...tab, id }], activeTabId: id });
  },

  closeTab: (id) => {
    const st = getState();
    const idx = st.tabs.findIndex((t) => t.id === id);
    const tabs = st.tabs.filter((t) => t.id !== id);
    const activeTabId =
      st.activeTabId === id ? (tabs[Math.max(0, idx - 1)]?.id ?? null) : st.activeTabId;
    setState({ tabs, activeTabId });
  },

  setActiveTab: (id) => setState({ activeTabId: id }),

  setFileContent: (path, content) => {
    const st = getState();
    setState({
      fileContents: { ...st.fileContents, [path]: content },
      dirtyFiles: [...new Set([...(Array.isArray(st.dirtyFiles) ? st.dirtyFiles : []), path])],
    });
  },

  loadFile: async (path) => {
    const id = getState().workspaceId;
    if (!id) return;
    try {
      const { content } = await get<{ path: string; content: string }>(
        `/workspaces/${id}/file?path=${encodeURIComponent(path)}`,
      );
      setState({ fileContents: { ...getState().fileContents, [path]: content } });
    } catch {
      setState({ fileContents: { ...getState().fileContents, [path]: '' } });
    }
  },

  saveFile: async (path, content) => {
    const id = getState().workspaceId;
    if (!id) return;
    await put(`/workspaces/${id}/file`, { path, content });
    const st = getState();
    setState({
      dirtyFiles: (Array.isArray(st.dirtyFiles) ? st.dirtyFiles : []).filter((p) => p !== path),
    });
  },

  createFile: async (path) => {
    const id = getState().workspaceId;
    if (!id || !path.trim()) return;
    await post(`/workspaces/${id}/file`, { path: path.trim(), content: '' });
    await getState().refreshTree();
    await getState().openFile(path.trim());
  },

  createFolder: async (path) => {
    const id = getState().workspaceId;
    if (!id || !path.trim()) return;
    // Directories materialize implicitly: a placeholder file creates the
    // parent chain, then is removed — the tree shows the (empty) folder.
    await post(`/workspaces/${id}/file`, { path: `${path.trim()}/.gitkeep`, content: '' });
    await getState().refreshTree();
  },

  renameEntry: async (from, to) => {
    const id = getState().workspaceId;
    if (!id || !from || !to.trim()) return;
    await post(`/workspaces/${id}/rename`, { from, to: to.trim() });
    const st = getState();
    // Move editor state to the new path.
    const tabs = st.tabs.map((t) =>
      t.path === from
        ? {
            ...t,
            path: to.trim(),
            id: `file:${to.trim()}`,
            title: to.trim().split('/').pop() ?? to.trim(),
          }
        : t,
    );
    const fileContents = { ...st.fileContents };
    if (fileContents[from] !== undefined) {
      fileContents[to.trim()] = fileContents[from];
      delete fileContents[from];
    }
    setState({
      tabs,
      fileContents,
      activeTabId: st.activeTabId === `file:${from}` ? `file:${to.trim()}` : st.activeTabId,
      dirtyFiles: (Array.isArray(st.dirtyFiles) ? st.dirtyFiles : []).map((p) =>
        p === from ? to.trim() : p,
      ),
    });
    await getState().refreshTree();
  },

  deleteEntry: async (path) => {
    const id = getState().workspaceId;
    if (!id || !path) return;

    // Capture content in memory so Undo can restore it (best-effort: files
    // unreadable right now are skipped; restore recreates what it can).
    const capture: DeletedCapture = { workspaceId: id, path, isDir: false, files: [] };
    try {
      const tree = await get<FileNode>(`/workspaces/${id}/tree`);
      const find = (n: FileNode): FileNode | null =>
        n.path === path ? n : (n.children?.map(find).find(Boolean) ?? null);
      const node = find(tree);
      if (node?.type === 'dir') {
        capture.isDir = true;
        const flatten = (n: FileNode): string[] =>
          n.type === 'file' ? [n.path] : (n.children ?? []).flatMap(flatten);
        const rels = node.path ? flatten(node) : [];
        for (const rel of rels.slice(0, 200)) {
          try {
            capture.files.push({
              path: rel,
              content: await get<{ content: string }>(
                `/workspaces/${id}/file?path=${encodeURIComponent(rel)}`,
              ).then((r) => r.content),
            });
          } catch {
            /* skip */
          }
        }
      } else {
        capture.files.push({
          path,
          content: await get<{ content: string }>(
            `/workspaces/${id}/file?path=${encodeURIComponent(path)}`,
          ).then((r) => r.content),
        });
      }
    } catch {
      /* capture failed — Undo unavailable */
    }

    await del(`/workspaces/${id}/file?path=${encodeURIComponent(path)}`);
    const st = getState();
    const victim = st.tabs.find((t) => t.path === path);
    const fileContents = { ...st.fileContents };
    delete fileContents[path];
    if (victim) st.closeTab(victim.id);
    setState({
      fileContents,
      dirtyFiles: (Array.isArray(st.dirtyFiles) ? st.dirtyFiles : []).filter((p) => p !== path),
    });
    await getState().refreshTree();

    if (capture.files.length) {
      const name = path.split('/').pop() ?? path;
      getState().showToast(`Deleted ${name}`, async () => {
        const wid = capture.workspaceId;
        if (getState().workspaces.find((w) => w.id === wid)) {
          for (const f of capture.files) {
            try {
              await post(`/workspaces/${wid}/file`, { path: f.path, content: f.content });
            } catch {
              /* gone */
            }
          }
          if (getState().workspaceId === wid) await getState().refreshTree();
        }
      });
    }
  },

  showToast: (message, undo) => {
    const toast: Toast = {
      id: Math.random().toString(36).slice(2, 10),
      message,
      undo,
      ts: Date.now(),
    };
    setState({ toasts: [...getState().toasts.slice(-3), toast] });
    setTimeout(() => getState().dismissToast(toast.id), 6000);
  },

  dismissToast: (id) => {
    setState({ toasts: getState().toasts.filter((t) => t.id !== id) });
  },

  loadSettings: async () => {
    const settings = await get<AppSettings>('/settings');
    setState({
      settings,
      chatModel: settings.omni.modelPrefs.chat ?? settings.omni.modelPrefs.coding ?? '',
    });
  },

  saveSettings: async (s) => {
    const settings = await put<AppSettings>('/settings', s);
    setState({
      settings,
      chatModel: settings.omni.modelPrefs.chat ?? settings.omni.modelPrefs.coding ?? '',
    });
  },

  refreshModels: async () => {
    try {
      // Selectable list = routing aliases + inferred-free chat-capable models.
      const sel = await get<{ connected: boolean; models: ModelInfo[] }>('/models/selectable');
      const models = sel.models ?? [];
      setState({
        omniConnected: sel.connected,
        models,
        omniError: sel.connected
          ? null
          : 'Model gateway unreachable — AI features disabled until it responds.',
      });
      // Keep any existing selection that is still offered; otherwise default
      // to '' (Auto → the server-side router picks per task).
      const keep = (cur: string) => (models.some((m) => m.id === cur) ? cur : '');
      if (sel.connected) {
        setState({
          selectedModel: keep(getState().selectedModel),
          chatModel: keep(getState().chatModel),
        });
      }
    } catch (e) {
      setState({ omniConnected: false, omniError: e instanceof Error ? e.message : String(e) });
      // One delayed retry: a backend restart or cold gateway at boot must not
      // leave the model pickers empty until the app is reloaded.
      setTimeout(() => {
        if (!useStore.getState().models.length) void useStore.getState().refreshModels();
      }, 4000);
    }
  },

  toggleShowAllModels: async (on) => {
    setState({ showAllModels: on });
    if (on && !getState().allModels) {
      try {
        const r = await get<{ models: CatalogEntry[] }>('/models/all');
        setState({ allModels: r.models ?? [] });
      } catch {
        /* picker falls back to the selectable list */
      }
    }
  },

  newChat: () => {
    const wid = getState().workspaceId;
    const session: ChatSession = {
      id: Math.random().toString(36).slice(2, 10),
      title: 'New chat',
      messages: [],
      createdAt: Date.now(),
      workspaceId: wid,
    };
    // A new chat clears the panel completely: no stale run artifacts, no
    // live badge, no leftover stream text or status line from the old thread.
    // It stays scoped to THIS workspace — other projects' threads untouched.
    setState({
      chatSessions: [session, ...getState().chatSessions],
      activeChatId: session.id,
      ...(wid ? { chatTaskByWs: { ...getState().chatTaskByWs, [wid]: '' } } : {}),
      agentStream: {},
      chatStatus: null,
      invokedSkillIds: [],
      chatStreaming: false,
    });
    if (wid) persistChatsFor(wid);
  },

  selectChat: (id) => {
    // Returning to a session re-binds its task (if any) so the live badge
    // and stream follow the conversation you're actually looking at.
    const st = getState();
    const session = st.chatSessions.find((s) => s.id === id);
    const boundTask =
      [...(session?.messages ?? [])].reverse().find((m) => m.taskId)?.taskId ?? null;
    setState({
      activeChatId: id,
      ...(session?.workspaceId && boundTask
        ? { chatTaskByWs: { ...st.chatTaskByWs, [session.workspaceId]: boundTask } }
        : {}),
    });
    if (session?.workspaceId) persistChatsFor(session.workspaceId);
  },

  deleteChat: (id) => {
    const st = getState();
    const gone = st.chatSessions.find((s) => s.id === id);
    const sessions = st.chatSessions.filter((s) => s.id !== id);
    setState({
      chatSessions: sessions,
      activeChatId: st.activeChatId === id ? (sessions[0]?.id ?? null) : st.activeChatId,
    });
    if (gone?.workspaceId) persistChatsFor(gone.workspaceId);
  },

  sendChat: async (content, attachments) => {
    if (chatAbort) {
      try {
        chatAbort.abort();
      } catch {
        /* already done */
      }
    }
    chatAbort = new AbortController();
    const st = getState();
    let activeId = st.activeChatId;
    const active = st.chatSessions.find((s) => s.id === activeId);
    // The thread must belong to the workspace on screen — never continue
    // another project's conversation because it happened to be selected.
    if (!active || active.workspaceId !== st.workspaceId) {
      st.newChat();
      activeId = getState().activeChatId;
    }
    // `/skill-name` invocation: carry the referenced skill with the request.
    const invocation = extractSkillInvocation(content);
    const skills = getState().skills;
    let invokedSkill: ChatMessage['skillInvocation'];
    if (invocation) {
      const sk =
        skills.find((s) => s.id.toLowerCase() === invocation.skillId.toLowerCase()) ??
        skills.find(
          (s) => s.name.toLowerCase().replace(/\s+/g, '-') === invocation.skillId.toLowerCase(),
        );
      if (sk?.enabled) {
        invokedSkill = { id: sk.id, name: sk.name };
        content = invocation.rest || `Using the ${sk.name} skill, respond to this in context.`;
      } else {
        // Disabled or unknown skills are not callable — say so inline.
        getState().showToast(
          sk
            ? `Skill "${sk.name}" is disabled — enable it in the Skills panel to call it.`
            : `No skill "/${invocation.skillId}" in this project.`,
        );
      }
    }
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: 'user',
      content,
      ts: Date.now(),
      attachments,
      skillInvocation: invokedSkill,
    };
    const assistantMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: 'assistant',
      content: '',
      ts: Date.now(),
      pending: true,
    };
    setState({
      chatSessions: getState().chatSessions.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: [...s.messages, userMsg, assistantMsg],
              title: s.messages.length === 0 ? content.slice(0, 40) : s.title,
            }
          : s,
      ),
      chatStreaming: true,
      invokedSkillIds: invokedSkill ? [invokedSkill.id] : [],
      chatStatus: { kind: 'thinking', reason: 'Waiting for the model…', ts: Date.now() },
    });
    // The user's message is durable content — persist it right away (the
    // pending assistant bubble streams in via updateAssistant below).
    if (st.workspaceId) persistChatsFor(st.workspaceId);

    const session = getState().chatSessions.find((s) => s.id === activeId)!;
    const history = session.messages
      .filter((m) => !m.pending && m.content)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    const updateAssistant = (text: string, done: boolean, error = false) => {
      setState({
        chatSessions: getState().chatSessions.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: text, pending: !done, error: error || m.error }
                    : m,
                ),
              }
            : s,
        ),
        chatStreaming: !done && getState().chatStreaming,
      });
      // Completed assistant answers are durable — persist on done only, not
      // on every streamed token.
      if (done && st.workspaceId) persistChatsFor(st.workspaceId);
    };
    const setStatus = (s: StreamStatus | null) => setState({ chatStatus: s });

    const attemptOnce = async (): Promise<void> => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          model: getState().chatModel || getState().selectedModel,
          skillsEnabled: true,
          skillId: invokedSkill?.id,
        }),
        signal: chatAbort?.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error('No response stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setStatus(null); // tokens are flowing — no delay notice needed
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.type === 'delta') {
              acc += payload.delta;
              updateAssistant(acc, false);
            } else if (payload.type === 'reset') {
              // Server switched to a fallback model mid-stream (the first
              // model was dead) — discard partial text and start over.
              acc = '';
              updateAssistant('', false);
            } else if (payload.type === 'done') {
              acc = payload.text || acc;
              updateAssistant(acc, true);
            } else if (payload.type === 'error') {
              throw new Error(payload.error);
            } else if (payload.type === 'model') {
              setStatus({
                kind: 'degraded',
                reason: `Routed to fallback model ${payload.model}`,
                ts: Date.now(),
              });
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input')
              throw parseErr;
          }
        }
      }
      updateAssistant(acc, true);
    };

    // Network hiccup protocol: subtle status text, not a bubble. A bubble
    // appears only when every attempt is exhausted. A user Stop aborts the
    // fetch (AbortError) and exits WITHOUT retrying — the partial answer
    // already streamed stays in the bubble.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (chatAbort?.signal.aborted) break;
      try {
        await attemptOnce();
        setStatus(null);
        setState({ invokedSkillIds: [] });
        return;
      } catch (e) {
        if (chatAbort?.signal.aborted) break;
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < MAX_ATTEMPTS) {
          setStatus({
            kind: 'retrying',
            reason: msg,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
            ts: Date.now(),
          });
          await new Promise((r) => setTimeout(r, 800 * attempt));
        } else {
          setStatus(null);
          setState({ invokedSkillIds: [] });
          updateAssistant(`⚠ ${msg}`, true, true);
        }
      }
    }
  },

  stopChat: () => {
    const ac = chatAbort;
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* already aborted */
      }
    }
    // Finalize the streaming bubble NOW with whatever partial text arrived:
    // the aborted reader will reject inside sendChat and only break out of
    // its retry loop — it never touches state again after this.
    const st = getState();
    const sess = st.chatSessions.find((s) => s.id === st.activeChatId);
    const streamingMsg = [...(sess?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'assistant' && m.pending && !m.taskId);
    setState({
      chatSessions: sess
        ? st.chatSessions.map((s) =>
            s.id === sess.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === streamingMsg?.id
                      ? { ...m, pending: false, content: m.content || '_(stopped)_' }
                      : m,
                  ),
                }
              : s,
          )
        : st.chatSessions,
      chatStreaming: false,
      chatStatus: null,
      invokedSkillIds: [],
    });
    if (st.workspaceId) persistChatsFor(st.workspaceId);
  },

  startTask: async (prompt, mode) => {
    const st = getState();
    if (!st.workspaceId) return;
    // Agent tasks participate in the chat transcript too: user bubble + a
    // pending assistant bubble that streams while the agent "thinks" and
    // settles on the final answer. Process noise stays in the activity log.
    let activeId = st.activeChatId;
    const active = st.chatSessions.find((s) => s.id === activeId);
    // Only continue a thread of THIS workspace — a task run from workspace A
    // must never append into workspace B's conversation.
    if (!active || active.workspaceId !== st.workspaceId) {
      st.newChat();
      activeId = getState().activeChatId;
    }
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: 'user',
      content: prompt,
      ts: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: 'assistant',
      content: '',
      ts: Date.now(),
      pending: true,
    };
    setState({
      chatSessions: getState().chatSessions.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: [...s.messages, userMsg, assistantMsg],
              title:
                s.messages.length === 0 ? prompt.replace(/^\[PLAN\] /, '').slice(0, 40) : s.title,
            }
          : s,
      ),
    });
    const task = await post<AgentTask>('/agent/tasks', {
      prompt,
      mode,
      workspaceId: st.workspaceId,
      model: st.chatModel || st.selectedModel,
    });
    // Tag the pending assistant bubble with the task id so the streamed
    // answer settles into THIS thread even if the user switches workspace
    // (or starts another run elsewhere) while it's streaming.
    setState({
      tasks: [task, ...st.tasks],
      activeTaskByWs: { ...getState().activeTaskByWs, [st.workspaceId]: task.id },
      chatTaskByWs: { ...getState().chatTaskByWs, [st.workspaceId]: task.id },
      agentStream: { ...st.agentStream, [task.id]: '' },
      chatSessions: getState().chatSessions.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.pending && m.role === 'assistant' ? { ...m, taskId: task.id } : m,
              ),
            }
          : s,
      ),
    });
  },

  loadTasks: async () => {
    try {
      const tasks = await get<AgentTask[]>('/agent/tasks');
      // Replace unconditionally — an empty server list is the truth after a
      // backend restart with a cleared registry, and stale client-side rows
      // (e.g. a 'running' ghost the old process never finalized) must die.
      const st = getState();
      const wid = st.workspaceId;
      const defaultForWs =
        wid && !st.activeTaskByWs[wid] ? (tasks.find((t) => t.workspaceId === wid)?.id ?? null) : null;
      setState({
        tasks,
        ...(wid && defaultForWs
          ? { activeTaskByWs: { ...st.activeTaskByWs, [wid]: defaultForWs } }
          : {}),
      });
      // Finalize pending chat bubbles whose task is already terminal on the
      // server — a missed WS 'task' event (backend restart mid-run) must not
      // leave typing dots spinning forever.
      const terminalIds = new Set(
        tasks
          .filter((t) => ['completed', 'failed', 'cancelled'].includes(t.status))
          .map((t) => t.id),
      );
      if (terminalIds.size) {
        let touched = false;
        const next = getState().chatSessions.map((s) => ({
          ...s,
          messages: s.messages.map((m) => {
            if (m.role === 'assistant' && m.pending && m.taskId && terminalIds.has(m.taskId)) {
              touched = true;
              return {
                ...m,
                pending: false,
                content: m.content || '(no response — task ended while away)',
              };
            }
            return m;
          }),
        }));
        if (touched) setState({ chatSessions: next });
      }
      // Replay in-flight streams after a reload: the backend holds the live
      // buffer for running tasks, so a mid-run refresh doesn't blank the panel.
      for (const t of tasks) {
        if (t.status !== 'running') continue;
        try {
          const ss = await get<{ status: string; buffer: string }>(
            `/agent/tasks/${t.id}/stream-state`,
          );
          if (ss.buffer)
            setState((s2) => ({ agentStream: { ...s2.agentStream, [t.id]: ss.buffer } }));
        } catch {
          /* task may have finished between list and fetch */
        }
      }
    } catch {
      /* ignore */
    }
  },

  loadMemory: async () => {
    const id = getState().workspaceId;
    if (!id) return;
    try {
      const memory = await get<MemoryEntry[]>(`/workspaces/${id}/memory`);
      setState({ memory });
    } catch {
      /* ignore */
    }
  },

  addMemory: async (text) => {
    const id = getState().workspaceId;
    if (!id || !text.trim()) return;
    await post(`/workspaces/${id}/memory`, { text: text.trim() });
    await getState().loadMemory();
  },

  removeMemory: async (entryId) => {
    const id = getState().workspaceId;
    if (!id) return;
    await del(`/workspaces/${id}/memory/${entryId}`);
    await getState().loadMemory();
  },

  clearMemory: async () => {
    const id = getState().workspaceId;
    if (!id) return;
    await post(`/workspaces/${id}/memory/clear`, {});
    await getState().loadMemory();
  },

  selectTask: (id) => {
    const wid = getState().workspaceId;
    if (!wid) return;
    setState({ activeTaskByWs: { ...getState().activeTaskByWs, [wid]: id ?? '' } });
  },

  taskAction: async (id, action) => {
    await post(`/agent/tasks/${id}/${action}`);
  },

  approvePlan: async (taskId, model) => {
    await post(`/agent/tasks/${taskId}/plan/approve`, { model });
    await getState().loadTasks();
  },

  rejectPlan: async (taskId) => {
    await post(`/agent/tasks/${taskId}/plan/reject`, {});
    await getState().loadTasks();
  },

  commentPlan: async (taskId, comments) => {
    await post(`/agent/tasks/${taskId}/plan/comment`, { comments });
    await getState().loadTasks();
  },

  answerQuestion: async (id, answer) => {
    await post(`/agent/questions/${id}/answer`, { answer });
    setState({ questions: getState().questions.filter((q) => q.id !== id) });
  },

  decidePermission: async (id, decision) => {
    await post('/permissions/decide', { id, decision });
    setState({ permissions: getState().permissions.filter((p) => p.id !== id) });
  },

  refreshContext: async () => {
    try {
      const context = await get<ContextReport>('/context');
      setState({ context });
    } catch {
      /* ignore */
    }
  },

  refreshHealth: async () => {
    try {
      const health = await get<{
        models: Record<string, { status: string; lastChecked: number; lastError?: string }>;
      }>('/health/models');
      setState({ modelHealth: health.models ?? {} });
    } catch {
      /* health endpoint unreachable — leave last known */
    }
  },

  refreshSkills: async () => {
    // Skills are scoped to the project folder: the effective enabled set is
    // per-workspace, so pass the active workspace id when we have one.
    const wsId = getState().workspaceId;
    const skills = await get<Skill[]>(
      `/skills${wsId ? `?workspaceId=${encodeURIComponent(wsId)}` : ''}`,
    );
    setState({ skills });
  },

  toggleSkill: async (id) => {
    const wsId = getState().workspaceId;
    await post(`/skills/${id}/toggle${wsId ? `?workspaceId=${encodeURIComponent(wsId)}` : ''}`);
    await getState().refreshSkills();
  },

  saveSkill: async (s) => {
    await post('/skills', s);
    await getState().refreshSkills();
  },

  deleteSkill: async (id) => {
    await del(`/skills/${id}`);
    await getState().refreshSkills();
  },

  acceptProposal: async (id) => {
    await post(`/proposals/${id}/accept`);
    setState({ proposals: getState().proposals.filter((p) => p.id !== id) });
  },

  rejectProposal: async (id) => {
    await post(`/proposals/${id}/reject`);
    setState({ proposals: getState().proposals.filter((p) => p.id !== id) });
  },

  wipeData: async (keep: string[]) => {
    const result = await post<{ removed: string[]; errors: string[]; dataDir: string }>(
      '/data/wipe',
      { keep },
    );
    if (result.errors.length) {
      getState().showToast(`Wipe completed with errors: ${result.errors.join(', ')}`);
    } else {
      getState().showToast(`Wiped: ${result.removed.join(', ')}`);
    }
    // Reload settings and models since they may have been wiped
    await getState().loadSettings();
    void getState().refreshModels();
    return result;
  },

  loadReview: async () => {
    const id = getState().workspaceId;
    const dirty = getState().dirtyFiles;
    const dirtyCount = Array.isArray(dirty) ? dirty.length : dirty.size;
    if (!id) return { branch: '', files: [], dirtyCount };
    try {
      const r = await get<{
        current: string;
        files: {
          path: string;
          status: string;
          additions: number;
          deletions: number;
          hunks: import('../../shared/types').DiffHunk[];
        }[];
      }>(`/workspaces/${id}/git/review`);
      return { branch: r.current, files: r.files, dirtyCount };
    } catch {
      return { branch: '', files: [], dirtyCount };
    }
  },
}));

// Dev/verification hook: reachable from the console as __aether.store.
// Not used by app code; safe to keep (no secrets, devtools only).
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__aether = { useStore };
}
