import { nanoid } from 'nanoid';
import type {
  ActivityItem, AgentMessage, AgentQuestion, AgentTask, AgentTaskStatus,
  ContextReport, DiffArtifact, ImplementationPlan, PersistedTask, Skill,
  TaskStep, UsageEvent, VerificationEntry, Walkthrough,
} from '../shared/types.js';
import type { OmniClient } from './omni.js';
import type { ToolRegistry } from './tools.js';
import type { SkillManager } from './skills.js';
import type { ContextManager } from './context.js';
import type { ProjectIndexer } from './indexer.js';
import type { WorkspaceManager } from './workspace.js';
import type { TerminalManager } from './terminal.js';
import type { MemoryManager } from './memory.js';
import type { HistoryStore } from './history.js';
import { emitActivity, emitQuestion, emitTask, emitUsage, bus } from './bus.js';
import * as store from './dbStore.js';
import { pickModelForTask, CATEGORY_PREFERENCES, DEFAULT_FALLBACK } from './router.js';

const SYSTEM_BASE = `You are Aether, an autonomous coding agent working inside a professional IDE.
You operate on the user's real workspace using tools. Rules:
- NEVER reveal chain-of-thought. Keep visible output concise and operational.
- Use tools to inspect the project before editing. Read files before editing them.
- After writing/editing files, verify with run_tests/run_build when relevant.
- Prefer edit_file with exact old_string matches; use write_file for new files.
- When you learn a durable fact about the project or user preferences (conventions, decisions, gotchas), persist it with save_memory.
- Stop when the task is complete and summarize what you did.
- Current date: {DATE}. Workspace: {WS}.`;

export interface AgentTaskOptions {
  prompt: string;
  mode: 'agent' | 'ask' | 'plan';
  title?: string;
  model?: string;
  workspaceId: string;
  /** Plan context when spawned from an approved plan. */
  planContext?: string;
  fromPlanId?: string;
}

export class AgentEngine {
  tasks = new Map<string, AgentTask>();
  messages = new Map<string, AgentMessage[]>(); // taskId -> transcript
  private streamBuf = new Map<string, string>(); // taskId -> in-flight assistant text
  questions = new Map<string, AgentQuestion>();
  private controllers = new Map<string, AbortController>();
  private paused = new Set<string>();
  private resolvers = new Map<string, (v: string) => void>();
  // DB linkage per running task: session id, latest agent_action id.
  // dbActions is read by index.ts when capturing git commits.
  private dbSessions = new Map<string, number | null>();
  private lastActionId = new Map<string, number | null>();
  dbActions = new Map<string, number | null>();
  /** Plan-mode raw context handed to a follow-on agent task after approval. */
  private planContext = new Map<string, string | null>();
  /** Pending plan-approval resolvers for plan-mode tasks. */
  private planApprovals = new Map<string, (approved: boolean, comments: { line: number; text: string }[]) => void>();
  // Model selection: the requested model (if any) flows straight to the
  // gateway; otherwise preferences, fallback, and finally the live catalog
  // provide the model. auto/* aliases (if the gateway offers them) pass
  // through untouched — the gateway resolves them itself.
  resolveModel(raw: string): string {
    if (!raw) return raw;
    // OmniRoute's v1-compatible gateway resolves auto/ aliases itself (returns
    // 200 and picks the right underlying model), so pass them through as-is.
    if (raw.startsWith('auto/')) return raw;
    // Anything else that's actually in the catalog is already concrete — pass
    // through. Unknown concrete names will fail at the gateway in one shot;
    // we don't heuristic-convert them here on purpose (the caller can retry
    // with a catalog model). With stale cached catalogs in headless/offline
    // mode, this still returns the requested name, which fails fast.
    return raw;
  }

  constructor(
    private omni: OmniClient,
    private tools: ToolRegistry,
    private skills: SkillManager,
    private ctx: ContextManager,
    private indexer: ProjectIndexer,
    private ws: WorkspaceManager,
    private terms: TerminalManager,
    private memory: MemoryManager,
    private history: HistoryStore,
  ) {}

  /** Optional health monitor — set after construction (index.ts wires it). */
  health?: { recordOutcome(model: string, ok: boolean, note?: string): void; inCooldown(model: string): boolean; healthFor(model: string): { status: string; lastError?: string } };

  async enqueue(opts: AgentTaskOptions): Promise<AgentTask> {
    const task: AgentTask = {
      id: nanoid(10),
      title: opts.title ?? opts.prompt.slice(0, 60),
      prompt: opts.prompt,
      mode: opts.mode,
      status: 'queued',
      model: opts.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workspaceId: opts.workspaceId,
      activity: [],
      filesChanged: [],
      steps: [],
      diffs: [],
      fromPlanId: opts.fromPlanId,
    };
    this.tasks.set(task.id, task);
    this.messages.set(task.id, [{ role: 'user', content: opts.prompt, ts: Date.now() }]);
    this.planContext.set(task.id, opts.planContext ?? null);
    emitTask({ ...task });
    this.persist(task.id);
    void this.run(task.id);
    return task;
  }

  /** Mirror task + transcript to the history store (debounced on the store side). */
  private persist(taskId: string) {
    const t = this.tasks.get(taskId);
    if (t) this.history.save(t, this.messages.get(taskId) ?? []);
  }

  /** Re-register a persisted task after a restart without re-running it. */
  restorePersisted(p: PersistedTask) {
    if (this.tasks.has(p.task.id)) return;
    const t = p.task;
    if (!['completed', 'failed', 'cancelled'].includes(t.status)) {
      t.status = 'failed';
      t.error = t.error ?? 'Interrupted by restart';
    }
    // Normalize tasks persisted before the artifact fields existed.
    t.steps ??= [];
    t.diffs ??= [];
    this.tasks.set(t.id, t);
    this.messages.set(t.id, p.messages);
  }

  listTasks(workspaceId?: string): AgentTask[] {
    const all = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    return workspaceId ? all.filter((t) => t.workspaceId === workspaceId) : all;
  }

  getTask(id: string) {
    return this.tasks.get(id);
  }

  /** In-memory streaming state for a task — lets a reloaded frontend replay
   *  the in-flight assistant text instead of showing an empty shell. */
  streamState(taskId: string): { status: string; buffer: string } {
    const t = this.tasks.get(taskId);
    return { status: t?.status ?? 'unknown', buffer: this.streamBuf.get(taskId) ?? '' };
  }

  getMessages(taskId: string): AgentMessage[] {
    return this.messages.get(taskId) ?? [];
  }

  pause(taskId: string) {
    this.paused.add(taskId);
    this.setStatus(taskId, 'paused');
  }

  resume(taskId: string) {
    this.paused.delete(taskId);
    const t = this.tasks.get(taskId);
    if (t && t.status === 'paused') {
      this.setStatus(taskId, 'running');
      this.resolvers.get(taskId)?.('resume');
    }
  }

  cancel(taskId: string) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    this.controllers.get(taskId)?.abort();
    this.setStatus(taskId, 'cancelled');
    void this.closeDbSession(taskId, 'cancelled');
  }

  /** User approved (or rejected) a plan-mode task's Implementation Plan. */
  approvePlan(taskId: string, approved: boolean, comments: { line: number; text: string }[] = []): boolean {
    const resolve = this.planApprovals.get(taskId);
    if (!resolve) return false;
    this.planApprovals.delete(taskId);
    resolve(approved, comments);
    return true;
  }

  /** Mark a plan approved and spawn the implementation task (Agent mode). */
  async executePlan(taskId: string, model?: string): Promise<AgentTask | null> {
    const t = this.tasks.get(taskId);
    if (!t?.plan) return null;
    t.plan.status = 'approved';
    t.plan.updatedAt = Date.now();
    this.activity(taskId, 'Plan approved — switching to Agent mode', 'done');
    this.setStatus(taskId, 'completed');
    return this.enqueue({
      prompt: `Implement this approved plan:\n\n${t.plan.raw}\n\nOriginal request: ${t.prompt}`,
      mode: 'agent',
      title: `Implement: ${t.title.replace(/^Plan: /, '').slice(0, 50)}`,
      model: model ?? t.model,
      workspaceId: t.workspaceId,
      planContext: t.plan.raw,
      fromPlanId: t.plan.id,
    });
  }

  /** Resolve the plan-approval gate, then spawn the implementation task. */
  async approvePlanAndExecute(taskId: string, model?: string): Promise<AgentTask | null> {
    this.approvePlan(taskId, true);
    // Give the parked execute() loop a tick to observe the approval and
    // return before we spawn the follow-on task.
    await new Promise((r) => setTimeout(r, 50));
    return this.executePlan(taskId, model);
  }

  /** Update a plan with revision comments (constraint text) and regenerate. */
  async revisePlan(taskId: string, comments: { line: number; text: string }[], model?: string): Promise<boolean> {
    const t = this.tasks.get(taskId);
    if (!t?.plan) return false;
    // Inject comments as constraints and regenerate the plan with the model.
    const constraint = comments.map((c) => `- (plan line ${c.line}) ${c.text}`).join('\n');
    t.plan.comments.push(...comments.map((c) => ({ ...c, ts: Date.now() })));
    t.plan.status = 'revised';
    t.plan.updatedAt = Date.now();
    this.setStatus(taskId, 'planning');
    try {
      const wsId = t.workspaceId;
      const ws = this.ws.require(wsId);
      const map = this.indexer.getCodebaseMap();
      const sys = 'You are Aether, revising an implementation plan based on user feedback. Output ONLY the revised plan in markdown (numbered steps, files to touch, approach, and why). No preamble.';
      const messages = [
        { role: 'system', content: sys },
        { role: 'system', content: `Project map:\n${map}` },
        { role: 'user', content: `Original request: ${t.prompt}\n\nCurrent plan:\n${t.plan.raw}\n\nUser feedback to incorporate:\n${constraint}\n\nProduce the revised plan.` },
      ];
      const selectable = this.omni.selectableModels.length ? this.omni.selectableModels : this.omni._modelCatalog;
      const decision = pickModelForTask({ prompt: t.prompt, mode: 'plan', files: [], hasErrorText: false }, selectable);
      const result = await this.omni.chatStream(
        { model: (model ?? t.model) ? this.resolveModel((model ?? t.model)!) : decision.model, messages, signal: undefined },
        { onDelta: () => {}, onUsage: () => {} },
      );
      if (result.text && result.text.length > 40) {
        t.plan.raw = result.text.trim();
        t.plan.files = extractFilePaths(result.text);
        t.plan.revision += 1;
        t.plan.status = 'pending_approval';
        this.activity(taskId, `Plan revised (r${t.plan.revision}) — ${comments.length} comment(s) incorporated`, 'done');
      } else {
        t.plan.status = 'pending_approval';
        this.activity(taskId, 'Plan revision failed — keeping previous plan', 'error');
      }
    } catch (err) {
      t.plan.status = 'pending_approval';
      this.activity(taskId, `Plan revision failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    t.updatedAt = Date.now();
    emitTask({ ...t });
    this.persist(taskId);
    return true;
  }

  /** Replace the task's step list (used right after generation). */
  private setSteps(taskId: string, steps: TaskStep[]) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.steps = steps;
    emitTask({ ...t });
    this.persist(taskId);
  }

  /** Mark a step's status by fuzzy label match (agent may reword slightly). */
  private markStep(taskId: string, labelFragment: string, status: TaskStep['status']) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const frag = labelFragment.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const step = t.steps.find((s) => {
      const sl = s.label.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      return sl.includes(frag) || frag.includes(sl);
    });
    if (step && step.status !== 'done') {
      step.status = status;
      emitTask({ ...t });
      this.persist(taskId);
    }
  }

  /**
   * Run the project's verification commands (build → test). Returns every
   * entry (for the Walkthrough) plus the first failure (drives auto-repair).
   * Emits System Log lines; Task List step marking happens in the caller so
   * pass/fail semantics stay in one place.
   */
  private async runVerification(
    task: AgentTask,
    cwd: string,
    signal: AbortSignal,
  ): Promise<{ all: VerificationEntry[]; firstFailure: VerificationEntry | null }> {
    const all: VerificationEntry[] = [];
    for (const cmd of ['npm run build', 'npm test']) {
      if (signal.aborted) break;
      try {
        const r = await this.terms.exec(cmd, cwd, 120_000, signal);
        const ok = r.code === 0;
        const entry: VerificationEntry = {
          command: cmd,
          output: (`exit=${r.code}\n` + [r.stdout, r.stderr].filter(Boolean).join('\n')).slice(0, 4000),
          ok,
          ts: Date.now(),
        };
        all.push(entry);
        if (ok) {
          this.activity(task.id, `Verified: ${cmd}`, 'done');
          break; // first successful check is enough
        }
        this.activity(task.id, `Verification failed: ${cmd}`, 'error');
        return { all, firstFailure: entry };
      } catch (err) {
        const out = err instanceof Error ? err.message : String(err);
        const entry: VerificationEntry = { command: cmd, output: out.slice(0, 4000), ok: false, ts: Date.now() };
        all.push(entry);
        this.activity(task.id, `Verification failed: ${cmd}`, 'error');
        return { all, firstFailure: entry };
      }
    }
    return { all, firstFailure: null };
  }

  /** Surface a verification failure as a live in_progress step in the Task List. */
  private addRepairStep(taskId: string, label: string, detail: string) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.steps = [
      // Completed/failed repair steps stay in the list as history; only a
      // still-live one is replaced by the newer round.
      ...t.steps.filter((s) => !(s.id.startsWith('repair-') && s.status === 'in_progress')),
      { id: `repair-${nanoid(6)}`, label, detail, status: 'in_progress' },
    ];
    emitTask({ ...t });
    this.persist(taskId);
  }

  /** Resolve the live repair step(s) after a verification round. */
  private completeVerifySteps(taskId: string, ok: boolean, failure?: VerificationEntry) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    let changed = false;
    for (const s of t.steps) {
      if (s.id.startsWith('repair-') && s.status === 'in_progress') {
        s.status = ok ? 'done' : 'failed';
        if (!ok && failure) s.detail = failure.output.slice(0, 800);
        changed = true;
      }
    }
    if (changed) {
      emitTask({ ...t });
      this.persist(taskId);
    }
  }

  /** Advance the next pending step to in_progress when work begins. */
  private advanceSteps(taskId: string) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const next = t.steps.find((s) => s.status === 'pending');
    if (next) {
      next.status = 'in_progress';
      emitTask({ ...t });
    }
  }

  retry(taskId: string, prompt?: string) {
    const t = this.tasks.get(taskId);
    if (!t) return null;
    return this.enqueue({
      prompt: prompt ?? t.prompt,
      mode: t.mode,
      title: `${t.title} (retry)`,
      model: t.model,
      workspaceId: t.workspaceId,
    });
  }

  /** Agent asks the user a question; the loop awaits the answer. */
  askQuestion(taskId: string, q: { title: string; kind: AgentQuestion['kind']; options?: AgentQuestion['options'] }): Promise<string> {
    const question: AgentQuestion = { id: nanoid(10), taskId, title: q.title, kind: q.kind, options: q.options, ts: Date.now() };
    this.questions.set(question.id, question);
    emitQuestion(question);
    this.setStatus(taskId, 'awaiting_question');
    return new Promise((resolve) => {
      this.resolvers.set(question.id, resolve);
    });
  }

  answerQuestion(questionId: string, answer: string) {
    const resolve = this.resolvers.get(questionId);
    if (resolve) {
      const q = this.questions.get(questionId);
      if (q) q.answer = answer;
      this.resolvers.delete(questionId);
      const q2 = this.questions.get(questionId);
      if (q2) this.setStatus(q2.taskId, 'running');
      resolve(answer);
      return true;
    }
    return false;
  }

  private setStatus(taskId: string, status: AgentTaskStatus) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    t.status = status;
    t.updatedAt = Date.now();
    emitTask({ ...t });
    this.persist(taskId);
  }

  private activity(taskId: string, label: string, status: ActivityItem['status'], extra?: Partial<ActivityItem>) {
    const item: ActivityItem = { id: nanoid(10), taskId, label, status, icon: status === 'done' ? '✓' : status === 'running' ? '⟳' : status === 'error' ? '✗' : '○', ts: Date.now(), ...extra };
    const t = this.tasks.get(taskId);
    if (t) { t.activity.push(item); emitTask({ ...t }); }
    emitActivity(item);
    this.persist(taskId);
    return item;
  }

  private async waitWhilePaused(taskId: string) {
    while (this.paused.has(taskId)) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async run(taskId: string) {
    const task = this.tasks.get(taskId)!;
    const ctrl = new AbortController();
    this.controllers.set(taskId, ctrl);
    try {
      await this.execute(task, ctrl.signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Aborted by user') {
        this.setStatus(taskId, 'cancelled');
        void this.closeDbSession(taskId, 'cancelled');
      } else {
        this.activity(taskId, `Task failed: ${msg}`, 'error');
        task.error = msg;
        this.setStatus(taskId, 'failed');
        void this.closeDbSession(taskId, 'failed');
      }
    } finally {
      this.controllers.delete(taskId);
    }
  }

  private async execute(task: AgentTask, signal: AbortSignal) {
    this.setStatus(task.id, 'planning');
    const wsId = task.workspaceId;
    const ws = this.ws.require(wsId);

    // DB-backed session for this task (null when the database is unavailable)
    const dbProjectId = await store.getProjectId(ws.root).catch(() => null)
      ?? await store.upsertProject(ws.name, ws.root).catch(() => null);
    const dbSessionId = await store.startSession(dbProjectId).catch(() => null);
    this.dbSessions.set(task.id, dbSessionId);

    // 1. Inspect project (incremental index)
    await this.waitWhilePaused(task.id);
    if (signal.aborted) throw new Error('Aborted by user');
    if (!this.indexer.ready || this.indexer.workspaceId !== wsId) {
      this.activity(task.id, 'Analyzing project…', 'running');
      await this.indexer.index(wsId);
    }
    this.activity(task.id, 'Analyzed project', 'done');

    // 1b. PLAN MODE → Implementation Plan artifact, then await approval.
    if (task.mode === 'plan') {
      const map = this.indexer.getCodebaseMap();
      const sys = 'You are Aether, producing an implementation plan. Output ONLY the plan in markdown: a one-line goal, numbered steps, files to touch (use backtick-quoted paths), the approach, and why it works. No preamble.';
      const messages = [
        { role: 'system', content: sys },
        { role: 'system', content: `Project map:\n${map}` },
        { role: 'user', content: task.prompt },
      ];
      const selectable = this.omni.selectableModels.length ? this.omni.selectableModels : this.omni._modelCatalog;
      const decision = pickModelForTask({ prompt: task.prompt, mode: 'plan', files: [], hasErrorText: false }, selectable);
      const model = task.model ? this.resolveModel(task.model) : decision.model;
      this.activity(task.id, `Drafting plan with ${model}`, 'running');
      const result = await this.omni.chatStream(
        {
          model,
          messages,
          signal,
        },
        {
          onDelta: (d) => {
            this.streamBuf.set(task.id, (this.streamBuf.get(task.id) ?? '') + d);
            bus.emit('agent:delta', { taskId: task.id, delta: d });
            bus.emit('agent:status', null); // content flowing — clear any stall notice
          },
          onUsage: () => {},
        },
      );
      this.streamBuf.delete(task.id);
      const raw = (result.text || '').trim();
      if (!raw) throw new Error('Plan generation returned an empty response — check the gateway/model and retry.');
      const plan: ImplementationPlan = {
        id: nanoid(10),
        taskId: task.id,
        raw,
        files: extractFilePaths(raw),
        status: 'pending_approval',
        comments: [],
        revision: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      task.plan = plan;
      this.activity(task.id, `Plan drafted (r${plan.revision}, ${plan.files.length} file(s) to touch) — awaiting approval`, 'done');
      this.setStatus(task.id, 'awaiting_approval');
      // Park until approve/reject arrives via REST. Rejection completes the
      // task quietly; approval hands off to a fresh agent-mode task.
      const approved = await new Promise<boolean>((resolve) => {
        this.planApprovals.set(task.id, (ok) => resolve(ok));
      });
      if (!approved) {
        this.activity(task.id, 'Plan rejected', 'error');
        if (task.plan) task.plan.status = 'rejected';
        this.setStatus(task.id, 'cancelled');
        await this.closeDbSession(task.id, 'cancelled');
        return;
      }
      return; // executePlan() has spawned the implementation task
    }

    // 2. Load skills — scoped to this workspace's enabled set (per-project).
    const enabledSkills = await this.skills.enabledFor(task.workspaceId);
    const skillFragment = this.skills.composeSystemFragment(enabledSkills);
    if (enabledSkills.length) {
      this.activity(task.id, `Active skills: ${enabledSkills.map((s) => s.name).join(', ')}`, 'done');
      const apple = enabledSkills.find((s) => /apple/i.test(s.name));
      if (apple) this.activity(task.id, `Using active skill: ${apple.name}`, 'done');
    }

    // 3. Context selection: relevant files into context manager
    const relevant = this.indexer.relevantFiles(task.prompt, 10);
    for (const rel of relevant) {
      try { this.ctx.includeFile(rel, await this.ws.readFile(wsId, rel)); } catch { /* gone */ }
    }
    if (relevant.length) this.activity(task.id, `Included ${relevant.length} relevant file(s) in context`, 'done');

    // 3b. TASK LIST artifact — concrete steps before any file is touched.
    if (task.mode === 'agent') {
      this.activity(task.id, 'Drafting task list…', 'running');
      const steps = await this.generateSteps(task).catch(() => [] as TaskStep[]);
      if (steps.length) {
        this.setSteps(task.id, steps);
        this.activity(task.id, `Task list: ${steps.length} step(s)`, 'done');
      } else {
        this.activity(task.id, 'Task list unavailable (model offline) — proceeding', 'error');
      }
    }

    // 4. Build messages
    const memoryFragment = await this.memory.fragment(wsId);
    const sys = SYSTEM_BASE
      .replace('{DATE}', new Date().toISOString().slice(0, 10))
      .replace('{WS}', ws.name)
      + (skillFragment ? `\n\n${skillFragment}` : '')
      + (memoryFragment ? `\n\n${memoryFragment}` : '');
    this.ctx.systemTokens = Math.ceil(sys.length / 4);
    this.ctx.skillsTokens = Math.ceil(skillFragment.length / 4);

    const fileBlocks = this.ctx.buildFileBlocks(Math.max(4000, this.ctx.contextWindow * 0.4));
    const map = this.indexer.getCodebaseMap();
    const history = this.getMessages(task.id);

    const planFragment = this.planContext.get(task.id);
    // Plan-mode tasks returned earlier — only 'ask' and 'agent' reach here.
    const modeInstruction: string = task.mode === 'ask'
      ? 'MODE: ask — Answer the user\'s question about the codebase. Do not modify files.'
      : 'MODE: agent — Autonomously complete the task using tools. Continue until done.';

    const messages: { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }[] = [
      { role: 'system', content: sys },
      { role: 'system', content: `Project map:\n${map}` },
      { role: 'system', content: `Relevant files:\n${fileBlocks.text}` },
      { role: 'system', content: modeInstruction },
      ...(planFragment ? [{ role: 'system', content: `APPROVED IMPLEMENTATION PLAN (follow it closely):\n${planFragment}` }] : []),
      ...(task.steps.length ? [{ role: 'system', content: `TASK LIST (keep these steps in order; work through them one at a time):\n${task.steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n')}` }] : []),
      ...this.ctx.compressChat(history.map((m) => ({ role: m.role, content: m.content })), 12, 6000).map((m) => ({ role: m.role, content: m.content })),
    ];

    // 5. Checkpoint before execution (agent mode)
    if (task.mode === 'agent') {
      const cp = await this.tools.createCheckpointFor(wsId, task.id, `Before: ${task.title}`);
      task.checkpointId = cp.id;
      this.activity(task.id, `Checkpoint created (${cp.id})`, 'done');
    }

    // 6. Agent loop
    this.setStatus(task.id, 'running');
    let iterations = 0;
    let finalText = '';
    // Auto-repair bookkeeping: verification results collected across rounds
    // (declared outside the loop — they feed the Walkthrough on clean exit).
    const REPAIR_ROUNDS = 2;
    let repairRound = 0;
    const repairVerifications: VerificationEntry[] = [];

    while (iterations < 30) {
      iterations++;
      await this.waitWhilePaused(task.id);
      if (signal.aborted) throw new Error('Aborted by user');

      // Model resolution order: explicit task model (user's manual pick) →
      // automatic task-based routing → settings prefs → first catalog model.
      const selectable = this.omni.selectableModels.length ? this.omni.selectableModels : this.omni._modelCatalog;
      let autoDecision: import('../shared/types.js').RoutingDecision | null = null;
      let effective: string;
      if (task.model) {
        effective = this.resolveModel(task.model);
      } else {
        autoDecision = pickModelForTask(
          { prompt: task.prompt, mode: task.mode, files: task.filesChanged, hasErrorText: /error/i.test(task.prompt) },
          selectable,
          // Cooldown-aware routing: models with repeated recent failures are
          // skipped straight to the next preference (no wasted round-trip).
          (m) => this.health?.inCooldown(m) ?? false,
        );
        effective = this.resolveModel(autoDecision.model);
      }
      if (!effective) {
        effective =
          this.resolveModel(
            this.omni.settings.modelPrefs.coding ||
            this.omni.settings.modelPrefs.chat ||
            this.omni.settings.fallbackModel ||
            (this.omni._modelCatalog[0]?.id ?? ''),
          ) || '';
      }
      if (!effective) throw new Error('No model selected. Open Settings → Aether endpoint and choose a model.');
      // task.model keeps the user's originally REQUESTED model (often a combo
      // alias like auto/best-coding); it is deliberately NOT overwritten with
      // the concrete served model, because the gateway rotates routes between
      // calls and the alias re-resolves to a working route each time.
      const requestedModel = task.model;
      if (autoDecision) {
        this.activity(task.id, `Auto-routed to ${autoDecision.model}: ${autoDecision.reason}`, 'done');
      }
      this.activity(task.id, `Using model ${effective}`, 'done');

      const streamStart = Date.now();
      let usageSeen = false;
      const stream = this.omni.chatStream(
        { model: effective, messages, tools: task.mode === 'agent' ? this.tools.jsonSchema() : undefined, signal },
        {
          onDelta: (d) => {
            this.streamBuf.set(task.id, (this.streamBuf.get(task.id) ?? '') + d);
            bus.emit('agent:delta', { taskId: task.id, delta: d });
            bus.emit('agent:status', null); // content flowing — clear any stall notice
          },
          onUsage: (u) => {
            if (u) {
              usageSeen = true;
              this.recordUsage(u, task.id);
              // exact token accounting
              this.ctx.lastExact = { input: u.inputTokens, output: u.outputTokens };
              this.ctx.chatTokens = u.inputTokens;
              // cumulative thread totals for the context viewer
              this.ctx.recordThreadUsage(u.inputTokens, u.outputTokens, u.cachedInput ?? 0);
              // persist to model_usage with latency + cost from config/pricing.json
              void store.recordModelUsage({
                sessionId: dbSessionId,
                actionId: this.lastActionId.get(task.id) ?? null,
                modelName: u.model,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
                latencyMs: Date.now() - streamStart,
              }).catch(() => {});
            }
          },
        },
      );

      // Graceful degradation helper: the next model in the category's
      // preference list that we haven't tried and that is selectable.
      const nextCandidate = (tried: string[]): string | null => {
        const prefs = autoDecision ? CATEGORY_PREFERENCES[autoDecision.category] : [];
        return prefs.find((p) => !tried.includes(p) && selectable.some((m) => m.id === p)) ?? null;
      };
      const retryWithNext = async (cause: string) => {
        // Recovery ladder for a failed request:
        //   1. If the request was served via a combo alias, retry the SAME
        //      alias once — the gateway rotates routes between calls.
        //   2. Otherwise try the next model in the category's preference list.
        // The spinner entry created here is resolved to ✓/✗ by the caller
        // via the returned finish() callback, so a recovered retry never
        // leaves a dangling "running" item in the activity feed.
        const effectiveAlias = requestedModel && requestedModel.startsWith('auto/') ? requestedModel : null;
        let finish: (ok: boolean, note: string) => void;
        if (effectiveAlias && effectiveAlias !== effective && !retryWithNext.comboRetried) {
          retryWithNext.comboRetried = true;
          bus.emit('agent:status', { kind: 'retrying', reason: `Route ${effective} unavailable — retrying`, attempt: 1, maxAttempts: 2, ts: Date.now() });
          const item = this.activity(task.id, `Route ${effective} failed (${cause.slice(0, 90)}) — retrying via ${effectiveAlias}`, 'running');
          finish = (ok, note) => {
            item.status = ok ? 'done' : 'error';
            item.icon = ok ? '✓' : '✗';
            item.label += ` — ${note}`;
            emitTask({ ...task });
          };
          try {
            const r = await this.omni.chatStream(
              { model: effectiveAlias, messages, tools: task.mode === 'agent' ? this.tools.jsonSchema() : undefined, signal },
              {
                onDelta: (d) => {
                  this.streamBuf.set(task.id, (this.streamBuf.get(task.id) ?? '') + d);
                  bus.emit('agent:delta', { taskId: task.id, delta: d });
                },
                onUsage: () => { /* counted on success in the outer loop */ },
              },
            );
            return { r, finish };
          } catch (err) {
            finish(false, 'retry also failed');
            throw err;
          }
        }
        const next = nextCandidate([effective, task.model].filter(Boolean) as string[]);
        if (!next) throw new Error(cause);
        // Subtle chat status line (never a bubble): the UI shows "network
        // error… retrying (1/3)"-style text while the fallback runs.
        bus.emit('agent:status', { kind: 'retrying', reason: `Model ${effective} unavailable — retrying`, attempt: 1, maxAttempts: 2, ts: Date.now() });
        const item = this.activity(task.id, `Model ${effective} failed (${cause.slice(0, 100)}) — retrying with ${next}`, 'running');
        finish = (ok, note) => {
          item.status = ok ? 'done' : 'error';
          item.icon = ok ? '✓' : '✗';
          item.label += ` — ${note}`;
          emitTask({ ...task });
        };
        try {
          const r = await this.omni.chatStream(
            { model: next, messages, tools: task.mode === 'agent' ? this.tools.jsonSchema() : undefined, signal },
            {
              onDelta: (d) => {
                this.streamBuf.set(task.id, (this.streamBuf.get(task.id) ?? '') + d);
                bus.emit('agent:delta', { taskId: task.id, delta: d });
              },
              onUsage: () => { /* counted on success in the outer loop */ },
            },
          );
          task.model = next;
          return { r, finish };
        } catch (err) {
          finish(false, 'retry also failed');
          throw err;
        }
      };
      retryWithNext.comboRetried = false;

      let result;
      try {
        result = await stream;
        this.health?.recordOutcome(effective, true);
      } catch (err) {
        this.health?.recordOutcome(effective, false, err instanceof Error ? err.message : String(err));
        // Mid-request model failure → one retry on the next preference.
        const { r, finish } = await retryWithNext(err instanceof Error ? err.message : String(err));
        result = r;
        // Retry answered — close the spinner entry so the feed shows a
        // recovery, not a dangling "running" step.
        finish(!(result.text === '' && !result.toolCalls?.length && !result.finish), 'answered');
      }
      // Surface the model that actually served the request (gateway may
      // substitute on alias resolution or rate-limit rotation).
      if (result.resolvedModel && result.resolvedModel !== effective) {
        this.activity(task.id, `Served by ${result.resolvedModel} (for ${effective})`, 'done');
        bus.emit('agent:status', { kind: 'degraded', reason: `Routed to fallback model ${result.resolvedModel}`, ts: Date.now() });
      } else if (!result.text && !result.toolCalls.length) {
        // First token latency: clear the retry status once real content lands.
        bus.emit('agent:status', null);
      }
      // Robustness: a gateway that streams keepalives + an error chunk and
      // then ends (no text, no tool calls, no finish) is a failed request,
      // not an empty completion. Retry once on the next preference, then fail.
      if (!result.text && !result.toolCalls.length && !result.finish) {
        this.health?.recordOutcome(effective, false, 'empty response');
        const { r, finish } = await retryWithNext(`Model ${effective} returned an empty response — its upstream provider is likely unavailable`);
        result = r;
        const recovered = !!(result.text || result.toolCalls.length || result.finish);
        finish(recovered, recovered ? 'answered' : 'still empty');
        if (recovered) {
          // VISIBLE fallback line in the run's System Log (spec: never silent).
          this.activity(task.id, `Fallback used: ${effective} unavailable — served by ${result.resolvedModel ?? task.model ?? 'fallback'}`, 'done');
        } else {
          throw new Error(`Both the selected model and its fallback returned empty responses — the gateway's upstream providers are unavailable.`);
        }
      }
      // Some gateways (OmniRoute among them) don't echo `usage` in SSE
      // chunks. Fall back to a char-based estimate so the usage dashboard
      // still captures every model call.
      if (!usageSeen) {
        const estIn = Math.ceil(JSON.stringify(messages).length / 4);
        const estOut = Math.ceil((result.text || '').length / 4) + 8 * (result.toolCalls?.length ?? 0);
        const served = result.resolvedModel ?? effective;
        void store.recordModelUsage({
          sessionId: dbSessionId,
          actionId: this.lastActionId.get(task.id) ?? null,
          modelName: served,
          inputTokens: estIn,
          outputTokens: estOut,
          latencyMs: Date.now() - streamStart,
        }).catch(() => {});
        this.recordUsage({ model: served, inputTokens: estIn, outputTokens: estOut }, task.id);
      }
      finalText = result.text;
      this.streamBuf.delete(task.id); // committed to the transcript now
      if (result.text) {
        this.getMessages(task.id).push({ role: 'assistant', content: result.text, ts: Date.now() });
        // The closing turn (no tool calls → loop ends) is carried by the
        // Walkthrough artifact instead of a chat bubble, so the same text
        // doesn't render twice at the end of a run.
        const isClosingTurn = !result.toolCalls.length;
        if (!isClosingTurn) {
          bus.emit('agent:message', { taskId: task.id, content: result.text });
        }
        this.persist(task.id);
      }

      if (!result.toolCalls.length) {
        // Natural loop exit → verify the workspace before accepting completion.
        // A failed build/test becomes a visible in_progress Task List step and
        // the error goes back to the model for an auto-repair round (max 2),
        // instead of the run silently completing a broken workspace.
        if (task.mode === 'agent' && task.filesChanged.length && !signal.aborted) {
          this.setStatus(task.id, 'verifying');
          const failed = await this.runVerification(task, ws.root, signal);
          repairVerifications.push(...failed.all);
          if (failed.firstFailure && !signal.aborted) {
            if (repairRound < REPAIR_ROUNDS) {
              repairRound++;
              this.activity(task.id, `Repair round ${repairRound}/${REPAIR_ROUNDS}: ${failed.firstFailure.command} failed — tasking the agent to fix it`, 'running');
              this.addRepairStep(task.id, `Fix ${failed.firstFailure.command}`, failed.firstFailure.output);
              messages.push(
                { role: 'assistant', content: result.text || null },
                { role: 'user', content: `VERIFICATION FAILED — ${failed.firstFailure.command} exited non-zero. Fix the errors, then finish. Output (trimmed):\n${failed.firstFailure.output.slice(0, 3000)}` },
              );
              this.setStatus(task.id, 'running');
              continue; // re-enter the loop: the model now repairs and re-verifies
            }
            // Repairs exhausted and the workspace is still broken: honest
            // terminal failure — never a silent success in task history.
            this.completeVerifySteps(task.id, false, failed.firstFailure);
            task.error = `Verification failed after ${repairRound} repair round(s): ${failed.firstFailure.command}`;
            this.setStatus(task.id, 'failed');
            await store.endSession(dbSessionId, 'failed');
            throw new Error(task.error);
          }
          this.completeVerifySteps(task.id, true);
        }
        if (signal.aborted) throw new Error('Aborted by user');
        break;
      }

      // feed tool results back
      messages.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
      for (const tc of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.arguments || '{}'); } catch { /* malformed */ }
        const actionType = actionTypeFor(tc.name);
        const filePath = typeof args.path === 'string' ? (args.path as string) : null;
        // Capture the pre-edit content for the inline diff artifact.
        let preEdit: string | null = null;
        if (filePath && (tc.name === 'write_file' || tc.name === 'edit_file' || tc.name === 'delete_file')) {
          try { preEdit = await this.ws.readFile(wsId, filePath); } catch { preEdit = ''; }
        }
        this.advanceSteps(task.id);
        if (filePath) this.markStep(task.id, filePath, 'in_progress');
        const out = await this.tools.run(tc.name, args, { workspaceId: wsId, taskId: task.id, cwd: ws.root, autoApprove: false, signal });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: out });
        this.ctx.toolsTokens += Math.ceil(out.length / 4);
        const changed = (args.path as string) ?? undefined;
        if (changed && !task.filesChanged.includes(changed)) task.filesChanged.push(changed);
        // DIFF ARTIFACT: record what changed for the inline per-file diff UI.
        if (filePath && (tc.name === 'write_file' || tc.name === 'edit_file' || tc.name === 'delete_file')) {
          let post: string | null = null;
          try { post = await this.ws.readFile(wsId, filePath); } catch { post = null; }
          const artifact = buildDiffArtifact(filePath, preEdit ?? '', post, tc.name === 'delete_file');
          if (artifact) {
            const prev = task.diffs?.find((d) => d.path === filePath && d.ts > Date.now() - 60_000);
            if (prev) {
              // coalesce rapid successive edits to the same file
              const merged = buildDiffArtifact(filePath, prev.oldContent ?? '', post, false);
              if (merged) Object.assign(prev, merged, { ts: Date.now() });
            } else {
              task.diffs = [...(task.diffs ?? []), artifact];
              bus.emit('agent:diff', { taskId: task.id, diff: artifact });
            }
          }
          if (!/not found|ERROR/i.test(out)) this.markStep(task.id, filePath, 'done');
        }
        // Agent-made edits bypass the REST endpoints — mirror the file into
        // the files table here so agent_actions.file_id can link to it.
        if (filePath && dbProjectId && (tc.name === 'write_file' || tc.name === 'edit_file')) {
          await store.upsertFile(dbProjectId, filePath, typeof args.content === 'string' ? (args.content as string) : null).catch(() => {});
        }
        // persist the action (linked to session + file) so model_usage can reference it
        const actionId = await store
          .recordAgentAction({ sessionId: dbSessionId, actionType, filePath, projectId: dbProjectId, prompt: tc.name, result: out.slice(0, 8000) })
          .catch(() => null);
        if (actionId) this.lastActionId.set(task.id, actionId);
        this.dbActions.set(task.id, actionId);
        // Backfill: if this tool call made a commit before its action row
        // existed (commit broadcast fires inside the tool), link it now.
        if (actionId && typeof args.message === 'string') {
          await store.linkLatestCommitToAction(dbProjectId, actionId).catch(() => {});
        }
        this.persist(task.id);
      }
    }

    // 7. Verification record: on a clean exit every check that ran during the
    // loop is green (or verification was skipped). The entries feed the
    // Walkthrough artifact below.
    const verification: VerificationEntry[] = repairVerifications;

    // 8. Walkthrough artifact — the structured close-out, persisted to history.
    const walkthrough: Walkthrough = {
      title: task.title,
      summary: finalText || 'Task completed.',
      changes: (task.diffs ?? []).map((d) => ({ path: d.path, status: d.status, additions: d.additions, deletions: d.deletions })),
      verification,
      completedAt: Date.now(),
    };
    task.walkthrough = walkthrough;
    // Mark remaining pending steps done (the goal was reached).
    for (const s of task.steps) {
      if (s.status === 'pending' || s.status === 'in_progress') s.status = 'done';
    }
    this.activity(task.id, 'Task completed', 'done');
    this.setStatus(task.id, 'completed');
    await store.endSession(dbSessionId, 'completed');
  }

  /** Ask the model for a concrete, watchable step list for this task. */
  private async generateSteps(task: AgentTask): Promise<TaskStep[]> {
    const selectable = this.omni.selectableModels.length ? this.omni.selectableModels : this.omni._modelCatalog;
    const decision = pickModelForTask({ prompt: task.prompt, mode: 'planning' as never, files: [], hasErrorText: false }, selectable);
    const model = task.model ? this.resolveModel(task.model) : decision.model;
    const ws = this.ws.require(task.workspaceId);
    const map = this.indexer.getCodebaseMap();      const result = await this.omni.chatStream(
        {
          model,
          messages: [
            { role: 'system', content: 'You break coding tasks into concrete steps. Output ONLY a JSON array of 2-6 short step strings, e.g. ["read package.json","identify dependency issues","summarize findings"]. No other text.' },
            { role: 'user', content: `Workspace: ${ws.name}\nProject map (excerpt):\n${map.slice(0, 3000)}\n\nTask: ${task.prompt}` },
          ],
        },
        { onDelta: () => {}, onUsage: () => {} },
      );
    const text = (result.text || '').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .slice(0, 6)
      .map((label) => ({ id: nanoid(8), label, status: 'pending' as const }));
  }

  private recordUsage(u: { model: string; inputTokens: number; outputTokens: number }, taskId: string) {
    const ev: UsageEvent = { model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, kind: 'agent', ts: Date.now() };
    emitUsage(ev);
  }

  /** Close the DB session for a task that ends outside the normal completion path. */
  private async closeDbSession(taskId: string, status: 'completed' | 'failed' | 'cancelled') {
    const sid = this.dbSessions.get(taskId);
    if (sid) {
      await store.endSession(sid, status).catch(() => {});
      this.dbSessions.delete(taskId);
    }
  }
}

/** Map a tool name to an agent_actions.action_type. */
function actionTypeFor(toolName: string): string {
  if (['write_file', 'edit_file', 'delete_file', 'rename'].includes(toolName)) return 'edit';
  if (['run_command', 'run_tests', 'run_build', 'install'].includes(toolName)) return 'run';
  if (toolName === 'inspect_errors') return 'error_fix';
  if (toolName === 'git_commit') return 'commit';
  return 'suggest';
}

/** Build a DiffArtifact from pre/post content (null when nothing changed). */
function buildDiffArtifact(path: string, oldC: string, newC: string | null, deleted: boolean): DiffArtifact | null {
  const status: DiffArtifact['status'] = deleted ? 'deleted' : oldC === '' ? 'added' : 'modified';
  if (!deleted && newC === oldC) return null;
  const oldLines = oldC.split('\n');
  const newLines = (newC ?? '').split('\n');
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const additions = newLines.filter((l) => !oldSet.has(l) && l !== '').length;
  const deletions = oldLines.filter((l) => !newSet.has(l) && l !== '').length;
  return { id: nanoid(10), path, status, additions, deletions, oldContent: oldC, newContent: deleted ? '' : (newC ?? ''), ts: Date.now() };
}

/** Extract backtick-quoted file paths from a plan's markdown. */
function extractFilePaths(raw: string): string[] {
  const out = new Set<string>();
  for (const m of raw.matchAll(/`([\w./\\-]+\.[\w]{1,6})`/g)) out.add(m[1]);
  return [...out].slice(0, 20);
}
