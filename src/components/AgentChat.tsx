import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DiffEditor } from '@monaco-editor/react';
import { Plus, History, X, Pause, Play, RotateCw, ChevronRight, ChevronDown, Check, Ban, Circle, Loader2, FileCode2, TerminalSquare, ListTodo, Sparkles, MessageSquarePlus, Wrench, Zap } from 'lucide-react';
import { useStore } from '../lib/store';
import type { ActivityItem, ChatMessage, DiffArtifact, Walkthrough } from '../../shared/types';
import { ChatBubble, GlassButton } from './glass';

/**
 * AgentChat — one unified conversation in Antigravity's style:
 *  - your messages and the agent's replies as chat bubbles
 *  - tool calls rendered INLINE in the flow as compact, expandable cards
 *  - permissions / questions / proposals appear inline where they happen
 *  - streaming replies type out live; stalls show a subtle status line
 * Process noise (system events) stays out of the panel entirely — failures
 * surface as chat bubbles, never a compacted log drawer.
 */

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': case 'planning': return <Loader2 size={12} className="icon-run spin" />;
    case 'done': case 'completed': return <Check size={12} strokeWidth={2.5} className="icon-ok" />;
    case 'error': case 'failed': return <X size={12} strokeWidth={2.5} className="icon-err" />;
    case 'cancelled': return <Ban size={12} className="icon-dim" />;
    case 'paused': case 'awaiting_permission': case 'awaiting_question': return <Pause size={12} className="icon-warn" />;
    default: return <Circle size={10} className="icon-dim" />;
  }
}

/** Inline tool card: icon, name, param, expandable result. */
function ToolCard({ a }: { a: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const hasResult = !!(a.result || a.error || a.detail);
  const state = a.status === 'done' ? 'done' : a.status === 'error' ? 'error' : 'running';
  return (
    <div className={`ac-tool ${state} fade-in`}>
      <button className="ac-tool-head" onClick={() => hasResult && setOpen((o) => !o)} title={hasResult ? 'Toggle details' : undefined}>
        <span className="ac-tool-icon">
          {a.command ? <TerminalSquare size={12} /> : <FileCode2 size={12} />}
        </span>
        <span className="ac-tool-name">{a.tool ?? 'command'}</span>
        {(a.filePath || a.command) && <span className="ac-tool-param mono-path">{a.filePath ?? a.command}</span>}
        <span className="ac-tool-status"><StatusIcon status={a.status} /></span>
        {hasResult && <span className="tool-expand">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>}
      </button>
      {open && hasResult && <pre className={`ac-tool-result ${a.status === 'error' ? 'error' : ''}`}>{a.error ?? a.result ?? a.detail}</pre>}
    </div>
  );
}

/**
 * Run lifecycle for transient run artifacts (Actions row, diff cards):
 * show while the run is live → brief "finished" phase so the user sees the
 * final state → collapse/hide → unmount. The durable record of the same
 * work lives on in the Walkthrough card and ~/.aether/history — these
 * transient cards are the live view, not the archive.
 */
type LifecyclePhase = 'live' | 'finished' | 'hiding' | 'hidden';
const FINISH_HOLD_MS = 2600; // how long the finished state stays readable
const HIDE_ANIM_MS = 450;    // matches the CSS collapse animation

function useRunLifecycle(isLive: boolean): LifecyclePhase {
  const [phase, setPhase] = useState<LifecyclePhase>(isLive ? 'live' : 'hidden');

  useEffect(() => {
    if (isLive) { setPhase('live'); return; }
    // Only a run that was live transitions through finished — mounting with
    // no live task (restored history) starts hidden.
    setPhase((p) => (p === 'live' ? 'finished' : p));
  }, [isLive]);

  useEffect(() => {
    if (phase !== 'finished') return;
    const t = setTimeout(() => setPhase('hiding'), FINISH_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'hiding') return;
    const t = setTimeout(() => setPhase('hidden'), HIDE_ANIM_MS);
    return () => clearTimeout(t);
  }, [phase]);

  return phase;
}

/**
 * Actions dropdown — every tool call from the live run collapsed into ONE
 * row (count + current action + spinner) so the feed stays focused on the
 * agent's replies. Expands to the full per-call list on click.
 */
function ActionsDropdown({ items, finished }: { items: ActivityItem[]; finished: boolean }) {
  const [open, setOpen] = useState(false);
  const running = items.find((a) => a.status === 'running');
  const done = items.filter((a) => a.status === 'done').length;
  const errored = items.filter((a) => a.status === 'error').length;
  const current = running ?? items[items.length - 1];
  return (
    <div className={`ac-actions ${open ? 'open' : ''} ${finished ? 'finished' : ''} fade-in`}>
      <button className="ac-actions-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ac-actions-icon">
          {running ? <Loader2 size={12} className="icon-run spin" /> : finished ? <Check size={12} className="icon-ok" /> : <Wrench size={12} />}
        </span>
        <span className="ac-actions-label">{finished ? 'Actions finished' : 'Actions'}</span>
        <span className="ac-actions-count">{done}/{items.length}</span>
        {errored > 0 && <span className="ac-actions-errors">{errored} failed</span>}
        {current && !finished && <span className="ac-tool-param mono-path">{current.tool ?? current.command ?? 'working…'}</span>}
        <span className="tool-expand">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="ac-actions-body">
          {items.map((a) => <ToolCard key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

/** Inline permission prompt. */
function PermissionInline({ p }: { p: { id: string; title: string; detail: string; command?: string; path?: string; decision?: string } }) {
  const decidePermission = useStore((s) => s.decidePermission);
  return (
    <div className="ac-prompt fade-in">
      <div className="ac-prompt-head"><span className="warn">Permission required</span><span className="ac-tool-param">{p.title}</span></div>
      {p.detail && <div className="ac-note">{p.detail}</div>}
      {(p.command || p.path) && <pre className="ac-tool-result">{p.command ?? p.path}</pre>}
      <div className="choice-row">
        {p.decision
          ? <span className="choice-made">{p.decision === 'deny' ? 'Denied' : p.decision === 'always' ? 'Always allowed' : 'Allowed'}</span>
          : <>
              <button className="primary" onClick={() => void decidePermission(p.id, 'allow')}>Allow Once</button>
              <button onClick={() => void decidePermission(p.id, 'always')}>Allow Always</button>
              <button className="danger" onClick={() => void decidePermission(p.id, 'deny')}>Deny</button>
            </>}
      </div>
    </div>
  );
}

/** Inline agent question. */
function QuestionInline({ q }: { q: { id: string; title: string; kind: string; options?: { label: string; value: string }[] } }) {
  const answerQuestion = useStore((s) => s.answerQuestion);
  const [text, setText] = useState('');
  const [answered, setAnswered] = useState<string | null>(null);
  const answer = (v: string) => { setAnswered(v); void answerQuestion(q.id, v); };
  if (answered) {
    return (
      <div className="ac-prompt fade-in">
        <div className="ac-prompt-head"><span>{q.title}</span></div>
        <div className="choice-row"><span className="choice-made">Answered: {answered}</span></div>
      </div>
    );
  }
  return (
    <div className="ac-prompt fade-in">
      <div className="ac-prompt-head"><span>{q.title}</span></div>
      {q.options && (
        <div className="choice-row">{q.options.map((o) => <button key={o.value} onClick={() => answer(o.value)}>{o.label}</button>)}</div>
      )}
      {q.kind === 'text' && (
        <div className="choice-row">
          <input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…"
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) answer(text.trim()); }} />
          <button className="primary" disabled={!text.trim()} onClick={() => answer(text.trim())}>Continue</button>
        </div>
      )}
      {q.kind === 'yesno' && <div className="choice-row"><button className="primary" onClick={() => answer('yes')}>Yes</button><button onClick={() => answer('no')}>No</button></div>}
      {q.kind === 'confirm' && <div className="choice-row"><button className="primary" onClick={() => answer('confirm')}>Continue</button><button onClick={() => answer('cancel')}>Cancel</button></div>}
    </div>
  );
}

/** Task List artifact: concrete steps the agent generated, watched live. */
function TaskList({ steps }: { steps: { id: string; label: string; detail?: string; status: string }[] }) {
  const done = steps.filter((s) => s.status === 'done').length;
  const failed = steps.some((s) => s.status === 'failed');
  return (
    <div className="ac-tasklist fade-in">
      <div className="ac-tasklist-head">
        <ListTodo size={13} />
        <span className="ac-tasklist-title">Task List</span>
        <span className="ac-process-badge">{done}/{steps.length}</span>
        <span className="ac-tasklist-track"><span style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} /></span>
      </div>
      <div className="ac-tasklist-body">
        {steps.map((s) => (
          <div key={s.id} className={`ac-step ${s.status}`}>
            <span className="ac-step-icon">
              {s.status === 'done' && <Check size={12} strokeWidth={2.5} className="icon-ok" />}
              {s.status === 'in_progress' && <Loader2 size={12} className="icon-run spin" />}
              {s.status === 'failed' && <X size={12} strokeWidth={2.5} className="icon-err" />}
              {s.status === 'pending' && <Circle size={10} className="icon-dim" />}
            </span>
            <span className="ac-step-label">
              {s.label}
              {s.detail && s.status !== 'done' && (
                <details className="ac-step-detail">
                  <summary>output</summary>
                  <pre>{s.detail}</pre>
                </details>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inline diff artifact: one collapsed per-file diff using Monaco. */
function DiffArtifactCard({ diff }: { diff: DiffArtifact }) {
  const [open, setOpen] = useState(false);
  const statusLabel = diff.status === 'added' ? 'new' : diff.status === 'deleted' ? 'deleted' : 'edited';
  return (
    <div className="ac-diffcard fade-in">
      <button className="ac-diffcard-head" onClick={() => setOpen((v) => !v)}>
        <FileCode2 size={12} />
        <span className="ac-diffcard-path mono-path">{diff.path}</span>
        <span className="ac-diffcard-badge">{statusLabel}</span>
        <span className="diff-stat"><span className="add">+{diff.additions}</span> <span className="del">−{diff.deletions}</span></span>
        <span className="tool-expand" style={{ marginLeft: 'auto' }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="ac-diffcard-body fade-in">
          <InlineMonacoDiff original={diff.oldContent ?? ''} modified={diff.newContent ?? ''} />
        </div>
      )}
    </div>
  );
}

/** Monaco inline diff (side-by-side off, compact height, read-only). */
function InlineMonacoDiff({ original, modified }: { original: string; modified: string }) {
  return (
    <MonacoDiff
      original={original}
      modified={modified}
      height={Math.min(360, Math.max(120, Math.max(original.split('\n').length, modified.split('\n').length) * 19 + 20))}
    />
  );
}

/** Thin wrapper around @monaco-editor/react's DiffEditor. */
function MonacoDiff({ original, modified, height }: { original: string; modified: string; height: number }) {
  const themeName = useStore((s) => s.settings?.ui.theme ?? 'dark');
  return (
    <DiffEditor
      height={height}
      original={original}
      modified={modified}
      theme={`aether-${themeName}`}
      options={{
        readOnly: true,
        renderSideBySide: false,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        fontSize: 12,
        automaticLayout: true,
      }}
    />
  );
}

/**
 * Walkthrough artifact — ONLY when it carries real guidance: file changes
 * or verification the user can't see in the plain closing bubble. A
 * text-only walkthrough (question answered, no files touched) stays a
 * normal chat bubble instead of a duplicating card.
 */
function WalkthroughCard({ w }: { w: Walkthrough }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    // Liquid Glass: card pattern (.glass) + pointer glow (.glow — large,
    // static, low-frequency surface, within the .glow perf budget).
    <div className="ac-walkthrough fade-in glass glow">
      <div className="ac-walkthrough-head">
        <Sparkles size={13} />
        <span className="ac-walkthrough-title">Walkthrough</span>
      </div>
      <div className="ac-walkthrough-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{w.summary}</ReactMarkdown>
        {w.changes.length > 0 && (
          <>
            <div className="ac-walkthrough-section">Files changed</div>
            {w.changes.map((c) => (
              <div key={c.path} className="ac-proposal-file">
                <span className="mono-path">{c.path}</span>
                <span className="diff-stat"><span className="add">+{c.additions}</span> <span className="del">−{c.deletions}</span></span>
              </div>
            ))}
          </>
        )}
        {w.verification.length > 0 && (
          <>
            <div className="ac-walkthrough-section">Verification</div>
            {w.verification.map((v, i) => (
              <div key={i} className={`ac-verify ${v.ok ? 'ok' : 'fail'}`}>
                <button className="ac-verify-head" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
                  {v.ok ? <Check size={12} className="icon-ok" /> : <X size={12} className="icon-err" />}
                  <span className="mono-path">{v.command}</span>
                  <span className="tool-expand" style={{ marginLeft: 'auto' }}>{openIdx === i ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                </button>
                {openIdx === i && <pre className="ac-tool-result">{v.output}</pre>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Implementation Plan artifact: rendered markdown, line-click commenting
 * (Google-Docs style), Approve/Reject actions. Approving spawns Agent mode.
 */
function PlanArtifact({ task }: { task: { id: string; plan: NonNullable<import('../../shared/types').AgentTask['plan']> } }) {
  const plan = task.plan;
  const approvePlan = useStore((s) => s.approvePlan);
  const rejectPlan = useStore((s) => s.rejectPlan);
  const commentPlan = useStore((s) => s.commentPlan);
  const [pendingComment, setPendingComment] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = plan.raw.split('\n');

  const submitComment = async () => {
    if (pendingComment == null || !commentText.trim()) return;
    setBusy(true);
    await commentPlan(task.id, [{ line: pendingComment, text: commentText.trim() }]);
    setCommentText('');
    setPendingComment(null);
    setBusy(false);
  };

  return (
    <div className="ac-plan fade-in">
      <div className="ac-plan-head">
        <FileCode2 size={13} />
        <span className="ac-plan-title">Implementation Plan</span>
        <span className="ac-process-badge">r{plan.revision}</span>
        <span className={`ac-plan-status ${plan.status}`}>{plan.status.replace('_', ' ')}</span>
      </div>
      <div className="ac-plan-body" onClick={(e) => {
        const lineEl = (e.target as HTMLElement).closest('[data-line]');
        if (lineEl) { setPendingComment(Number(lineEl.getAttribute('data-line'))); setCommentText(''); }
      }}>
        {lines.map((ln, i) => (
          <div key={i} data-line={i} className={`ac-plan-line ${pendingComment === i ? 'commenting' : ''} ${plan.comments.some((c) => c.line === i) ? 'commented' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{ln || ' '}</ReactMarkdown>
            {plan.comments.filter((c) => c.line === i).map((c, ci) => (
              <div key={ci} className="ac-plan-comment"><MessageSquarePlus size={10} /> {c.text}</div>
            ))}
            {pendingComment === i && (
              <div className="ac-plan-commentbox fade-in" onClick={(e) => e.stopPropagation()}>
                <textarea
                  autoFocus
                  value={commentText}
                  placeholder="Comment — the plan will be regenerated with this as a constraint…"
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitComment(); } if (e.key === 'Escape') setPendingComment(null); }}
                />
                <div className="choice-row">
                  <button className="primary" disabled={!commentText.trim() || busy} onClick={() => void submitComment()}>{busy ? 'Revising plan…' : 'Comment & regenerate'}</button>
                  <button onClick={() => setPendingComment(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {plan.status === 'pending_approval' || plan.status === 'revised' ? (
        <div className="choice-row">
          <button className="primary" disabled={busy} onClick={() => void approvePlan(task.id)}>Approve & Implement</button>
          <button className="danger" disabled={busy} onClick={() => void rejectPlan(task.id)}>Reject</button>
          <span className="ac-plan-hint">Click any line to comment → plan regenerates</span>
        </div>
      ) : plan.status === 'approved' ? (
        <div className="choice-row"><span className="choice-made">Approved — implementation running below</span></div>
      ) : null}
    </div>
  );
}

/** Explicit failure state: retry, switch model, honest terminal display. */
function FailureCard({ task }: { task: { id: string; title: string; error?: string; model?: string; mode: string; prompt: string } }) {
  const models = useStore((s) => s.models);
  const startTask = useStore((s) => s.startTask);
  const [switchModel, setSwitchModel] = useState(false);
  const [picked, setPicked] = useState('');
  return (
    <div className="ac-failure fade-in">
      <div className="ac-failure-head">
        <X size={13} className="icon-err" />
        <span className="ac-failure-title">Task failed</span>
        <span className="ac-failure-detail">{task.error ?? 'Unknown error'}</span>
      </div>
      {/* Liquid Glass actions */}
      <div className="choice-row">
        <GlassButton className="primary btn-glass glass" onClick={() => void startTask(task.prompt, task.mode as 'agent')}><RotateCw size={11} /> Retry</GlassButton>
        <GlassButton className="btn-glass glass" onClick={() => setSwitchModel((v) => !v)}><FileCode2 size={11} /> Switch model</GlassButton>
      </div>
      {switchModel && (
        <div className="choice-row fade-in">
          <select value={picked} onChange={(e) => setPicked(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Pick a model…</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
          <button
            className="primary"
            disabled={!picked}
            onClick={() => {
              useStore.setState({ chatModel: picked });
              void startTask(task.prompt, task.mode as 'agent');
            }}
          >
            Retry with {picked || '…'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Streaming typing effect: reveals the accumulated text at a readable pace
 * (chunked catch-up so slow streams don't lag behind — chunk grows with the
 * backlog, a steady frame cadence). The reveal position lives in a ref so
 * successive deltas NEVER reset the animation to the start. Reduced-motion
 * users get the raw stream with no animation.
 */
function useTypewriter(streamText: string | undefined, enabled: boolean | undefined): string {
  const [shown, setShown] = useState('');
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const textRef = useRef(streamText ?? '');
  textRef.current = streamText ?? '';

  useEffect(() => {
    if (!enabled) { setShown(textRef.current); return; }
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const text = textRef.current;
      // Stream shrank (run restart) → clamp the cursor.
      if (text.length < posRef.current) posRef.current = text.length;
      const backlog = text.length - posRef.current;
      if (backlog > 0) {
        posRef.current += Math.max(1, Math.ceil(backlog / 24));
        setShown(text.slice(0, posRef.current));
      }
      rafRef.current = requestAnimationFrame(step);
    };
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [enabled]);
  return enabled ? shown : textRef.current;
}

function Bubble({ m, streamText, live }: { m: ChatMessage; streamText?: string; live?: boolean }) {
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const typed = useTypewriter(streamText, live && !reduceMotion);
  return (
    /* Liquid Glass: entrance motion via ChatBubble — explicit initial/animate
       only, deliberately NO `layout` prop (too expensive on long scrolling
       lists) and no per-bubble glow (mousemove cost per row in a dense feed). */
    <ChatBubble className={`ac-msg ${m.role} ${m.error ? 'error' : ''}`}>
      <div className="ac-bubble">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{typed || (m.pending ? '…' : '')}</ReactMarkdown>
        {m.pending && (
          <span className={`ac-typing ${typed ? 'typing-line' : ''}`} aria-label={typed ? 'typing' : 'waiting'}>
            <span /><span /><span />
          </span>
        )}
        {m.skillInvocation && (
          <span className="ac-skill-chip" title={`Skill invoked: ${m.skillInvocation.name}`}>
            <Zap size={10} /> {m.skillInvocation.name}
          </span>
        )}
      </div>
    </ChatBubble>
  );
}

export function AgentChat() {
  const sessions = useStore((s) => s.chatSessions);
  const activeChatId = useStore((s) => s.activeChatId);
  const newChat = useStore((s) => s.newChat);
  const selectChat = useStore((s) => s.selectChat);
  const tasks = useStore((s) => s.tasks);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const selectTask = useStore((s) => s.selectTask);
  const taskAction = useStore((s) => s.taskAction);
  const activity = useStore((s) => s.activity);
  const agentStream = useStore((s) => s.agentStream);
  const chatStatus = useStore((s) => s.chatStatus);
  const permissions = useStore((s) => s.permissions);
  const questions = useStore((s) => s.questions);
  const proposals = useStore((s) => s.proposals);
  const acceptProposal = useStore((s) => s.acceptProposal);
  const rejectProposal = useStore((s) => s.rejectProposal);
  const openTab = useStore((s) => s.openTab);

  const [showSessions, setShowSessions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === activeChatId);
  const chatMessages = session?.messages ?? [];

  // Running/paused tasks drive the pinned task header + live tool stream.
  // Bound to THIS chat: the explicitly selected task, the task this thread
  // spawned (chatTaskId), or a task whose bubbles live in this session —
  // never a global fallback that would leak another thread's run into a
  // fresh chat panel.
  const chatTaskId = useStore((s) => s.chatTaskId);
  const liveTask = tasks.find((t) => t.id === activeTaskId)
    ?? (chatTaskId ? tasks.find((t) => t.id === chatTaskId) : undefined)
    ?? tasks.find(
      (t) =>
        (t.status === 'running' || t.status === 'planning' || t.status === 'awaiting_permission') &&
        chatMessages.some((m) => m.taskId === t.id),
    );

  // Merge persisted task activity with live WS activity for the running task.
  // Only real tool activity renders — system/infra events are dropped from
  // the chat panel entirely (spec: no System Log drawer, no compacted noise).
  const timeline = useMemo<ActivityItem[]>(() => {
    if (!liveTask) return [];
    const seen = new Set<string>();
    const items = [...liveTask.activity, ...activity.filter((a) => a.taskId === liveTask.id)];
    return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      .filter((a) => a.tool || a.command);
  }, [liveTask, activity]);

  const streamText = liveTask ? agentStream[liveTask.id] : undefined;
  const task = liveTask ?? tasks.find((x) => x.id === activeTaskId) ?? null;
  // Older persisted tasks predate the artifacts — normalize defensively.
  const steps = task?.steps ?? [];
  const diffs = task?.diffs ?? [];
  const plan = task?.plan ?? null;
  const showPlan = !!plan && (task!.status === 'awaiting_approval' || plan.status === 'approved' || plan.status === 'revised' || plan.status === 'pending_approval');
  const failed = task?.status === 'failed';

  // Transient run artifacts (Actions row, diff cards) follow a show →
  // finish → hide lifecycle keyed to the run's liveness; the durable
  // record stays in the Walkthrough artifact and task history.
  // Liveness = the task is actually mid-run, not merely selected: after
  // completion activeTaskId still points here, but the run is over and the
  // artifacts must transition to finished → hidden.
  const LIVE_STATUSES = ['queued', 'planning', 'awaiting_approval', 'running', 'verifying', 'awaiting_permission', 'awaiting_question', 'paused'];
  const runLive = !!liveTask && LIVE_STATUSES.includes(liveTask.status);
  const actionsPhase = useRunLifecycle(runLive);
  const diffsPhase = useRunLifecycle(runLive);

  // Stale-proposal hygiene: only pending proposals younger than 30 minutes.
  const freshProposals = proposals.filter((p) => p.status === 'pending' && Date.now() - p.createdAt < 30 * 60 * 1000);

  // Stick-to-bottom: follow the live feed ONLY while the user is already at
  // (or near) the bottom. Once they scroll up to read, the auto-scroll stops
  // fighting them — scrolling back to the bottom re-engages it.
  const stickRef = useRef(true);
  const prevMsgCount = useRef(chatMessages.length);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    // A new user message always re-engages follow mode.
    if (chatMessages.length !== prevMsgCount.current) {
      prevMsgCount.current = chatMessages.length;
      stickRef.current = true;
    }
    if (!stickRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chatMessages.length, timeline.length, streamText]);

  const empty = chatMessages.length === 0 && timeline.length === 0 && permissions.length === 0 && questions.length === 0 && freshProposals.length === 0;

  return (
    <div className="agent-chat" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Slim header: new chat / sessions — Liquid Glass icon buttons */}
      <div className="ac-header">
        <GlassButton className="btn-glass glass ac-head-btn" onClick={newChat} title="New chat — clears the conversation"><Plus size={13} /></GlassButton>
        <GlassButton className="btn-glass glass ac-head-btn" onClick={() => setShowSessions((v) => !v)} title="Chat sessions"><History size={13} /></GlassButton>
        <GlassButton
          className="btn-glass glass ac-head-btn"
          onClick={() => window.dispatchEvent(new CustomEvent('aether:open-skill-menu'))}
          title="Invoke a skill — type /skill-id in the composer"
        ><Zap size={13} /></GlassButton>
        <div style={{ flex: 1 }} />
        {liveTask && (
          <span className="ac-live-badge">
            <StatusIcon status={liveTask.status} />
            <span className="ac-live-title" title={liveTask.title}>{liveTask.title}</span>
            {liveTask.status === 'running' && <button title="Pause" onClick={() => void taskAction(liveTask.id, 'pause')}><Pause size={11} /></button>}
            {liveTask.status === 'paused' && <button title="Resume" onClick={() => void taskAction(liveTask.id, 'resume')}><Play size={11} /></button>}
            {(liveTask.status === 'running' || liveTask.status === 'paused') && <button title="Cancel" onClick={() => void taskAction(liveTask.id, 'cancel')}><X size={11} /></button>}
            {(liveTask.status === 'failed' || liveTask.status === 'cancelled') && <button title="Retry" onClick={() => void useStore.getState().startTask(liveTask.prompt, liveTask.mode)}><RotateCw size={11} /></button>}
          </span>
        )}
      </div>

      {showSessions && (
        <div className="ac-sessions">
          {sessions.length === 0 && <div className="ac-note" style={{ padding: '4px 10px' }}>No sessions yet</div>}
          {sessions.map((s) => (
            <div key={s.id} className={`ac-session ${s.id === activeChatId ? 'active' : ''}`} onClick={() => selectChat(s.id)}>
              <span className="ac-session-title">{s.title}</span>
              <button className="danger" onClick={(e) => { e.stopPropagation(); useStore.getState().deleteChat(s.id); }}><X size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Unified scrollback */}
      <div className="ac-scroll" ref={scrollRef} onScroll={onScroll}>
        {empty && (
          <div className="empty-state" style={{ height: '100%' }}>
            <div>Agent chat</div>
            <div style={{ fontSize: 11, textAlign: 'center' }}>
              Ask anything or describe a task.<br />Tool calls and approvals appear right here in the flow.<br />
              <span style={{ color: 'var(--text-faint)' }}>Type /skill-id to invoke an enabled skill.</span>
            </div>
          </div>
        )}

        {chatMessages.map((m) => {
          // Walkthrough-gated dedup: when a real Walkthrough card renders
          // (changes or verification exist) the closing bubble is redundant.
          const w = task?.status === 'completed' ? task.walkthrough : undefined;
          const hasRealWalkthrough = !!w && (w.changes.length > 0 || w.verification.length > 0);
          if (hasRealWalkthrough && m.role === 'assistant' && !m.pending && m.content.trim() === w.summary.trim()) return null;
          return <Bubble key={m.id} m={m} streamText={m.pending && liveTask ? streamText : undefined} live={m.pending && !!liveTask} />;
        })}

        {/* Subtle status line — delay/retry reasons NEVER get a bubble */}
        {chatStatus && (
          <div className={`ac-status fade-in ${chatStatus.kind}`} role="status">
            {chatStatus.kind === 'thinking'
              ? <Loader2 size={11} className="spin" />
              : <RotateCw size={11} className="spin" />}
            <span>
              {chatStatus.kind === 'retrying'
                ? `Network error… retrying (${chatStatus.attempt}/${chatStatus.maxAttempts})`
                : chatStatus.reason}
            </span>
          </div>
        )}

        {/* 1. TASK LIST artifact — the thing the user watches. */}
        {task && steps.length > 0 && <TaskList steps={steps} />}

        {/* 2. Implementation Plan artifact (plan mode). */}
        {showPlan && plan && <PlanArtifact task={{ id: task!.id, plan }} />}

        {/* 3. Inline per-file diff artifacts from the run — transient:
            live while running, brief finished summary, then collapse away
            (the files themselves are on disk; the diff stays in history). */}
        {diffsPhase !== 'hidden' && (
          <div className={`ac-diffs-wrap ${diffsPhase === 'hiding' ? 'lifecycle-hide' : diffsPhase === 'finished' ? 'lifecycle-finished' : ''}`}>
            {diffs.map((d) => <DiffArtifactCard key={d.id} diff={d} />)}
          </div>
        )}

        {/* 4. Walkthrough artifact on completion — ONLY when it adds real
            guidance beyond the closing bubble (changes or verification). */}
        {task?.status === 'completed' && task.walkthrough
          && (task.walkthrough.changes.length > 0 || task.walkthrough.verification.length > 0)
          && <WalkthroughCard w={task.walkthrough} />}

        {/* 5. Explicit failure state: retry + switch model inline. */}
        {failed && task && <FailureCard task={task} />}

        {/* Live run: tool calls collapsed into one Actions dropdown. */}
        {actionsPhase !== 'hidden' && timeline.length > 0 && (
          <div className={actionsPhase === 'hiding' ? 'lifecycle-hide' : ''}>
            <ActionsDropdown items={timeline} finished={actionsPhase !== 'live'} />
          </div>
        )}

        {/* Inline prompts */}
        {permissions.map((p) => <PermissionInline key={p.id} p={p} />)}
        {questions.map((q) => <QuestionInline key={q.id} q={q} />)}
        {freshProposals.map((p) => (
          <div key={p.id} className="ac-prompt proposal fade-in">
            <div className="ac-prompt-head"><span className="warn">Proposed changes</span><span className="ac-tool-param">{p.files.length} file{p.files.length > 1 ? 's' : ''}</span></div>
            <div className="ac-note">
              {p.files.map((f) => (
                <div key={f.path} className="ac-proposal-file">
                  <span className="mono-path">{f.path}</span>
                  <span className="diff-stat"><span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span></span>
                </div>
              ))}
            </div>
            <div className="choice-row">
              <button className="primary" onClick={() => void acceptProposal(p.id)}>Accept</button>
              <button className="danger" onClick={() => void rejectProposal(p.id)}>Reject</button>
              <button onClick={() => openTab({ kind: 'diff', title: 'Diff', path: `proposal:${p.id}` })}>View Diff</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
