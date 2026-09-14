import React, { useState } from 'react';
import { Pause, Play, X, RotateCw, ChevronRight, ChevronDown, Brain, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { TaskStatusIcon, ActivityStatusIcon } from '../lib/icons';
import type { ActivityItem } from '../../shared/types';

/**
 * Agent panel — tool-call cards, inline permission prompts, streaming status.
 * States are color/icon driven only; layout never shifts on transitions.
 */

/** Present-tense verb phrase for a running activity item. */
function streamingVerb(a: ActivityItem): string {
  const tool = (a.tool ?? '').toLowerCase();
  if (tool.includes('read') || tool.includes('search') || tool.includes('grep')) return 'Reading file...';
  if (tool.includes('write') || tool.includes('edit') || tool.includes('patch')) return 'Editing file...';
  if (tool.includes('bash') || tool.includes('command') || tool.includes('terminal')) return 'Running command...';
  if (tool.includes('test')) return 'Running tests...';
  if (tool.includes('install')) return 'Installing package...';
  if (tool.includes('git')) return 'Working with git...';
  if (tool.includes('index') || tool.includes('map')) return 'Scanning codebase...';
  if (a.command) return 'Running command...';
  if (a.filePath) return 'Reading file...';
  const label = a.label.toLowerCase();
  if (label.startsWith('run')) return 'Running...';
  return `${a.label.replace(/\.+$/, '')}...`;
}

export function AgentPanel() {
  const tasks = useStore((s) => s.tasks);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const selectTask = useStore((s) => s.selectTask);
  const taskAction = useStore((s) => s.taskAction);
  const activity = useStore((s) => s.activity);
  const permissions = useStore((s) => s.permissions);
  const questions = useStore((s) => s.questions);
  const proposals = useStore((s) => s.proposals);
  // Stale-proposal hygiene: only pending proposals younger than 30 minutes
  // render as action cards. Older ones would otherwise pile up forever — the
  // underlying data stays in the store and remains viewable via the diff tab.
  const STALE_MS = 30 * 60 * 1000;
  const freshPending = proposals.filter((p) => p.status === 'pending' && Date.now() - p.createdAt < STALE_MS);
  const decidePermission = useStore((s) => s.decidePermission);
  const answerQuestion = useStore((s) => s.answerQuestion);
  const acceptProposal = useStore((s) => s.acceptProposal);
  const rejectProposal = useStore((s) => s.rejectProposal);
  const openTab = useStore((s) => s.openTab);
  const startTask = useStore((s) => s.startTask);
  const memory = useStore((s) => s.memory);
  const addMemory = useStore((s) => s.addMemory);
  const removeMemory = useStore((s) => s.removeMemory);
  const clearMemory = useStore((s) => s.clearMemory);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const task = tasks.find((t) => t.id === activeTaskId) ?? tasks[0];
  const items: ActivityItem[] = task
    ? [...task.activity, ...activity.filter((a) => a.taskId === task.id)]
    : activity;
  const seen = new Set<string>();
  const merged = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const timeline = merged.slice().reverse();

  const runningItem = timeline.find((a) => a.status === 'running' || a.status === 'pending');

  return (
    <div className="agent-panel">
      {/* Task queue — status is the dominant signal: color-coded left border
        per state, large status icon, truncated title with full title tooltip. */}
      {tasks.length > 0 && (
        <div className="agent-tasklist">
          {tasks.slice(0, 8).map((t) => (
            <div key={t.id} className={`agent-task status-${t.status} ${t.id === task?.id ? 'current' : ''}`} onClick={() => selectTask(t.id)} title={t.title}>
              <span className="status-icon"><TaskStatusIcon status={t.status} /></span>
              <span className="label" title={t.title}>{t.title}</span>
              <span className="agent-task-actions">
                {t.status === 'running' && <button title="Pause task" onClick={(e) => { e.stopPropagation(); void taskAction(t.id, 'pause'); }}><Pause size={12} /></button>}
                {t.status === 'paused' && <button title="Resume task" onClick={(e) => { e.stopPropagation(); void taskAction(t.id, 'resume'); }}><Play size={12} /></button>}
                {(t.status === 'running' || t.status === 'paused') && <button title="Cancel task" onClick={(e) => { e.stopPropagation(); void taskAction(t.id, 'cancel'); }}><X size={12} /></button>}
                {(t.status === 'failed' || t.status === 'cancelled') && <button title="Retry task" onClick={(e) => { e.stopPropagation(); void useStore.getState().startTask(t.prompt, t.mode); }}><RotateCw size={12} /></button>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Streaming status: pulsing dot + present-tense verb */}
      {runningItem && (
        <div className="streaming-status fade-in">
          <span className="pulse-dot" />
          <span>{streamingVerb(runningItem)}</span>
        </div>
      )}

      {/* Project memory strip — collapsible, count badge */}
      <MemoryStrip
        memory={memory}
        open={memoryOpen}
        onToggle={() => setMemoryOpen((v) => !v)}
        onAdd={(t) => void addMemory(t)}
        onRemove={(id) => void removeMemory(id)}
        onClear={() => void clearMemory()}
      />

      {/* Scrollback: tool cards + inline prompts */}
      <div className="agent-scroll">
        {timeline.length === 0 && !runningItem && permissions.length === 0 && questions.length === 0 && freshPending.length === 0 && (
          <div className="empty-state" style={{ padding: 20 }}>Agent activity will appear here.</div>
        )}

        {permissions.map((p) => <PermissionInline key={p.id} p={p} onDecide={(d) => void decidePermission(p.id, d)} />)}

        {questions.map((q) => <QuestionInline key={q.id} q={q} onAnswer={(a) => void answerQuestion(q.id, a)} />)}

        {freshPending.map((p) => (
          <div key={p.id} className="tool-card proposal fade-in">
            <div className="tool-head">
              <span className="tool-name">Proposed changes</span>
              <span className="tool-meta">{p.files.length} file{p.files.length > 1 ? 's' : ''}</span>
            </div>
            <div className="tool-params">
              {p.files.map((f) => (
                <div key={f.path} className="proposal-file">
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

        {timeline.map((a) => a.tool || a.command
          ? <ToolCallCard key={a.id} a={a} />
          : <ConversationLine key={a.id} a={a} />)}
      </div>

      {/* Persistent input bar was removed — the single Composer at the bottom
          of the right panel handles all task/chat input. */}
    </div>
  );
}

/** Collapsible project-memory strip: what the agent remembers about this workspace. */
function MemoryStrip({ memory, open, onToggle, onAdd, onRemove, onClear }: {
  memory: { id: string; text: string; source: 'agent' | 'user'; ts: number }[];
  open: boolean;
  onToggle: () => void;
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState('');

  return (
    <div className="memory-strip">
      <div className="memory-head" onClick={onToggle}>
        <Brain size={13} />
        <span className="memory-title">Memory</span>
        {memory.length > 0 && <span className="memory-count">{memory.length}</span>}
        {!open && memory.length > 0 && (
          <span className="memory-preview" title={memory[0].text}>{memory[0].source === 'user' ? '★ ' : ''}{memory[0].text}</span>
        )}
        {!open && memory.length === 0 && <span className="memory-preview">Nothing remembered yet</span>}
        <span className="tool-expand" style={{ marginLeft: 'auto' }}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </div>
      {open && (
        <div className="memory-body fade-in">
          {memory.length === 0 && <div className="memory-empty">Nothing remembered yet — the agent saves durable facts here as it works.</div>}
          {memory.map((m) => (
            <div key={m.id} className="memory-item">
              <span className="memory-text">{m.text}</span>
              <button className="memory-forget" title="Forget" onClick={() => onRemove(m.id)}><Trash2 size={11} /></button>
            </div>
          ))}
          {memory.length > 0 && <button className="memory-clear" onClick={onClear}>Forget all</button>}
          <div className="memory-add">
            <input
              value={text}
              placeholder="Add a fact the agent should always know…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText(''); }
              }}
            />
            <button className="primary" disabled={!text.trim()} onClick={() => { if (text.trim()) { onAdd(text.trim()); setText(''); } }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bordered tool-call block: name, params, collapsed/expandable result. */
function ToolCallCard({ a }: { a: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const hasResult = !!(a.result || a.error || a.detail);
  const statusClass = a.status === 'done' ? 'done' : a.status === 'error' ? 'error' : 'running';

  return (
    <div className={`tool-card ${statusClass} fade-in`}>
      <div className="tool-head" onClick={() => hasResult && setOpen((o) => !o)}>
        <span className="status-icon"><ActivityStatusIcon status={a.status} /></span>
        <span className="tool-name">{a.tool ?? 'command'}</span>
        {a.filePath && <span className="tool-param mono-path">{a.filePath}</span>}
        {a.command && !a.filePath && <span className="tool-param mono-path">{a.command}</span>}
        <span className="tool-expand">
          {hasResult && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        </span>
      </div>
      {a.label && a.label !== a.tool && !a.command && !a.filePath && (
        <div className="tool-sub">{a.label}</div>
      )}
      {open && hasResult && (
        <pre className={`tool-result ${a.status === 'error' ? 'error' : ''}`}>{a.error ?? a.result ?? a.detail}</pre>
      )}
    </div>
  );
}

/** Non-tool activity: plain conversational text line. */
function ConversationLine({ a }: { a: ActivityItem }) {
  return (
    <div className={`agent-line ${a.status} fade-in`} title={a.result ?? a.error ?? ''}>
      <span className="status-icon"><ActivityStatusIcon status={a.status} /></span>
      <span className="label">{a.label}{a.filePath && <span className="dim"> · {a.filePath}</span>}</span>
    </div>
  );
}

/** Inline permission prompt: allow/deny choices with accent selection. */
function PermissionInline({ p, onDecide }: { p: { id: string; title: string; detail: string; command?: string; path?: string; decision?: string }; onDecide: (d: 'allow' | 'always' | 'deny') => void }) {
  return (
    <div className="tool-card prompt fade-in">
      <div className="tool-head">
        <span className="tool-name warn">Permission required</span>
        <span className="tool-param">{p.title}</span>
      </div>
      {p.detail && <div className="tool-sub">{p.detail}</div>}
      {(p.command || p.path) && <pre className="tool-result">{p.command ?? p.path}</pre>}
      <div className="choice-row">
        {p.decision ? (
          <span className="choice-made">{p.decision === 'deny' ? 'Denied' : p.decision === 'always' ? 'Always allowed' : 'Allowed'}</span>
        ) : (
          <>
            <button className="primary" onClick={() => onDecide('allow')}>Allow Once</button>
            <button onClick={() => onDecide('always')}>Allow Always</button>
            <button className="danger" onClick={() => onDecide('deny')}>Deny</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Inline agent question with choice selection highlight. */
function QuestionInline({ q, onAnswer }: { q: { id: string; title: string; kind: string; options?: { label: string; value: string }[] }; onAnswer: (a: string) => void }) {
  const [text, setText] = useState('');
  const [answered, setAnswered] = useState<string | null>(null);

  const answer = (v: string) => { setAnswered(v); onAnswer(v); };

  if (answered) return (
    <div className="tool-card prompt fade-in">
      <div className="tool-head"><span className="tool-name">{q.title}</span></div>
      <div className="choice-row"><span className="choice-made">Answered: {answered}</span></div>
    </div>
  );

  return (
    <div className="tool-card prompt fade-in">
      <div className="tool-head"><span className="tool-name">{q.title}</span></div>
      {q.options && (
        <div className="choice-row">
          {q.options.map((o) => <button key={o.value} onClick={() => answer(o.value)}>{o.label}</button>)}
        </div>
      )}
      {q.kind === 'text' && (
        <div className="choice-row">
          <input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…"
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) answer(text.trim()); }} />
          <button className="primary" disabled={!text.trim()} onClick={() => answer(text.trim())}>Continue</button>
        </div>
      )}
      {q.kind === 'yesno' && (
        <div className="choice-row">
          <button className="primary" onClick={() => answer('yes')}>Yes</button>
          <button onClick={() => answer('no')}>No</button>
        </div>
      )}
      {q.kind === 'confirm' && (
        <div className="choice-row">
          <button className="primary" onClick={() => answer('confirm')}>Continue</button>
          <button onClick={() => answer('cancel')}>Cancel</button>
        </div>
      )}
    </div>
  );
}
