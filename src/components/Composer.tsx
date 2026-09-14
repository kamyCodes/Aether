import React, { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, Square, Zap } from 'lucide-react';
import { useStore } from '../lib/store';
import type { ChatMessage } from '../../shared/types';
import { GlassButton, GlassDropdown, GlassSegmentedControl, GlassToggle } from './glass';

/**
 * Slash-menu: typing `/` at the start of the composer offers the enabled
 * skills for this project. Picking one replaces the draft with `/skill-id `.
 */
function SkillSlashMenu({
  text,
  onPick,
  onClose,
}: {
  text: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const skills = useStore((s) => s.skills);
  const slashQuery = text.replace(/^\//, '').toLowerCase();
  const matches = skills
    .filter((s) => s.enabled)
    .filter(
      (s) =>
        !slashQuery ||
        s.id.toLowerCase().includes(slashQuery) ||
        s.name.toLowerCase().includes(slashQuery),
    )
    .slice(0, 8);
  if (!text.startsWith('/')) return null;
  return (
    <div className="ac-skill-menu fade-in" role="listbox" aria-label="Enabled skills">
      <div className="ac-skill-menu-head">/skills — enabled for this project</div>
      {matches.length === 0 && (
        <div className="ac-skill-item" style={{ cursor: 'default' }}>
          No enabled skills match “{slashQuery}”
        </div>
      )}
      {matches.map((s) => (
        <button
          key={s.id}
          className="ac-skill-item"
          onClick={() => {
            onPick(s.id);
            onClose();
          }}
          title={s.description}
        >
          <Zap size={11} />
          <span className="ac-skill-item-name">/{s.id}</span>
          <span className="ac-skill-item-desc">{s.description}</span>
        </button>
      ))}
    </div>
  );
}

const AUTONOMY_LABELS: Record<string, string> = {
  secure: 'Secure — approve everything',
  review: 'Review-driven — approve plan & commands',
  agent: 'Agent-driven — only destructive gated',
  custom: 'Custom rules',
};

type Attachment = NonNullable<ChatMessage['attachments']>[number];

/**
 * The single composer for the right panel — pinned at the bottom, chat-app
 * style. Mode (Agent / Ask / Plan) and model live inline; there is no other
 * task input anywhere in the app.
 */
export function Composer() {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Terminal "Ask Agent" (and other surfaces) can prefill the composer.
  const prefill = useStore((s) => s.composerPrefill);
  useEffect(() => {
    if (prefill) {
      setText(prefill);
      useStore.setState({ composerPrefill: '' });
    }
  }, [prefill]);
  const mode = useStore((s) => s.composerMode);
  const setMode = (m: 'agent' | 'ask' | 'plan') => useStore.setState({ composerMode: m });

  // The Zap button in the chat header dispatches this to open the skill menu;
  // seed the composer with "/" so the menu appears immediately.
  useEffect(() => {
    const onSkillPick = () => {
      setText('/');
      textareaRef.current?.focus();
    };
    window.addEventListener('aether:open-skill-menu', onSkillPick);
    return () => window.removeEventListener('aether:open-skill-menu', onSkillPick);
  }, []);
  const chatModel = useStore((s) => s.chatModel);
  const models = useStore((s) => s.models);
  const allModels = useStore((s) => s.allModels);
  const showAll = useStore((s) => s.showAllModels);
  const toggleShowAll = useStore((s) => s.toggleShowAllModels);
  const chatStreaming = useStore((s) => s.chatStreaming);
  const busyTask = useStore((s) =>
    s.tasks.some((t) => t.status === 'running' || t.status === 'planning' || t.status === 'queued'),
  );
  const busy = chatStreaming || busyTask;
  const taskAction = useStore((s) => s.taskAction);
  const modelHealth = useStore((s) => s.modelHealth);
  // Health for the effective selection (manual pick or Auto's likely route).
  const healthFor = (id: string) => modelHealth[id];
  const autoHealth = modelHealth['auto/coding:free'];
  const pickedHealth = chatModel ? healthFor(chatModel) : autoHealth;
  // A cancellable task is one the backend can actually stop (running/planning).
  const liveTaskId = useStore(
    (s) =>
      s.tasks.find(
        (t) => t.status === 'running' || t.status === 'planning' || t.status === 'queued',
      )?.id,
  );

  const placeholder =
    mode === 'agent'
      ? 'Describe a task for the agent… (Enter to run, Shift+Enter for newline)'
      : mode === 'plan'
        ? 'Describe what to plan — no files will be modified…'
        : 'Ask anything about the codebase…';

  function send() {
    const t = text.trim();
    if (!t || busy) return;
    if (mode === 'ask') {
      void useStore.getState().sendChat(t, attachments.length ? [...attachments] : undefined);
    } else {
      const prefix = mode === 'plan' ? '[PLAN] ' : '';
      void useStore
        .getState()
        .startTask(
          prefix +
            t +
            (attachments.length
              ? `\n\n(attachments: ${attachments.map((a) => a.name).join(', ')})`
              : ''),
          mode,
        );
    }
    setText('');
    setAttachments([]);
  }

  function onFiles(files: FileList | null) {
    for (const f of Array.from(files ?? []).slice(0, 5)) {
      const reader = new FileReader();
      const isImage = f.type.startsWith('image/');
      reader.onload = () =>
        setAttachments((a) => [
          ...a,
          { name: f.name, type: f.type, dataUrl: isImage ? String(reader.result) : undefined },
        ]);
      if (isImage) reader.readAsDataURL(f);
      else {
        reader.onload = () =>
          setAttachments((a) => [
            ...a,
            { name: f.name, type: f.type, text: String(reader.result).slice(0, 8000) },
          ]);
        reader.readAsText(f);
      }
    }
  }

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((a, i) => (
            <span key={i} className="attachment-chip">
              {a.dataUrl && <img src={a.dataUrl} alt={a.name} />}
              {a.name}
              <span
                className="close"
                onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}
              >
                ×
              </span>
            </span>
          ))}
        </div>
      )}
      {text.startsWith('/') && (
        <SkillSlashMenu text={text} onPick={(id) => setText(`/${id} `)} onClose={() => {}} />
      )}
      <textarea
        ref={textareaRef}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text.startsWith('/')) {
            setText('');
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-row">
        {/* Liquid Glass: Radix DropdownMenu (Escape/click-outside/arrow keys
            + .glass content) replaces the native <select>. The 1000+-entry
            model pickers below stay native — see the mapping note in
            components/glass.tsx. */}
        <GlassDropdown
          className="autonomy-select btn-glass glass"
          value={useStore.getState().settings?.agent?.autonomy?.mode ?? 'review'}
          onValueChange={(v) => {
            const s = useStore.getState().settings;
            if (!s) return;
            void useStore
              .getState()
              .saveSettings({
                ...s,
                agent: {
                  autonomy: { ...s.agent.autonomy, mode: v as typeof s.agent.autonomy.mode },
                },
              });
          }}
          options={Object.entries(AUTONOMY_LABELS).map(([v, label]) => ({
            value: v,
            label: label.split(' — ')[0],
          }))}
          title="Autonomy level — how much the agent can do without asking"
          ariaLabel="Autonomy level"
        />
        {/* Liquid Glass: Radix ToggleGroup + Framer layoutId indicator —
            arrow-key navigation and role=radiogroup for free; the vanilla
            rect-math indicator (lib/glass.ts) is superseded here. */}
        <GlassSegmentedControl
          layoutId="composer-mode"
          className="mode-toggle"
          ariaLabel="Composer mode"
          value={mode}
          onValueChange={(v) => setMode(v as 'agent' | 'ask' | 'plan')}
          options={[
            {
              value: 'agent',
              label: 'Agent',
              title: 'Agent — autonomous, can edit files and run commands',
            },
            {
              value: 'ask',
              label: 'Ask',
              title: 'Ask — answer questions about the code, no edits',
            },
            {
              value: 'plan',
              label: 'Plan',
              title: 'Plan — produce a plan without modifying anything',
            },
          ]}
        />
        {/* Health dot: last background-probe result for the effective model. */}
        {(() => {
          const h = pickedHealth;
          const cls =
            !h || h.status === 'unknown' ? 'unknown' : h.status === 'healthy' ? 'ok' : 'failing';
          const tip =
            !h || h.status === 'unknown'
              ? 'Health: not yet checked (background probe runs every 10 min)'
              : h.status === 'healthy'
                ? 'Health: OK (last probe succeeded)'
                : `Health: FAILING — ${h.lastError ?? 'recent probes failed'}. Auto-routing will skip it while it cools down.`;
          return <span className={`model-health-dot ${cls}`} title={tip} />;
        })()}
        {/* Liquid Glass: Radix Switch — role=switch + Space/Enter keyboard
            toggling replace the visually-hidden checkbox hack. */}
        <span
          className="show-all-models"
          title="Show every model in the gateway catalog, grouped by provider"
        >
          <GlassToggle
            checked={showAll}
            onCheckedChange={(v) => void toggleShowAll(v)}
            label="Show all models"
          />
          all
        </span>
        {showAll ? (
          /* Liquid Glass dropdown — same treatment as the autonomy selector.
             The full catalog is grouped by provider with the working-provider
             ✓ badge, mirroring the old native optgroups. */
          <GlassDropdown
            className="model-select btn-glass glass"
            contentClassName="dd-content-scroll"
            value={chatModel}
            onValueChange={(v) => useStore.setState({ chatModel: v })}
            title="Full catalog — grouped by provider. ✓ = provider is working (backed by your keys or with successful usage); (free) = inferred free; (paid) = unknown/paid"
            ariaLabel="Model"
            groups={(() => {
              if (!allModels)
                return [{ label: 'Loading', options: [{ value: '', label: 'loading catalog…' }] }];
              const byProvider = new Map<string, typeof allModels>();
              for (const m of allModels) {
                const list = byProvider.get(m.provider) ?? [];
                list.push(m);
                byProvider.set(m.provider, list);
              }
              return [...byProvider.entries()]
                .sort(
                  (a, b) =>
                    (b[1].some((x) => x.working) ? 1 : 0) - (a[1].some((x) => x.working) ? 1 : 0) ||
                    a[0].localeCompare(b[0]),
                )
                .map(([provider, list]) => ({
                  label: `${provider}${list.some((x) => x.working) ? ' ✓' : ''}`,
                  options: list.map((m) => ({
                    value: m.id,
                    label: `${m.working ? '✓ ' : ''}${m.free ? '(free) ' : m.routingAlias ? '(route) ' : '(paid) '}${m.id}`,
                  })),
                }));
            })()}
          />
        ) : (
          <GlassDropdown
            className="model-select btn-glass glass"
            contentClassName="dd-content-scroll"
            value={chatModel}
            onValueChange={(v) => useStore.setState({ chatModel: v })}
            title="Model — Auto lets the agent route to the best free model per task; other options are routing aliases or inferred-free models from OmniRoute"
            ariaLabel="Model"
            groups={[
              {
                label: 'Routing aliases',
                options: models
                  .filter((m) => m.routingAlias)
                  .map((m) => ({ value: m.id, label: m.id })),
              },
              {
                label: 'Free models',
                options: models
                  .filter((m) => !m.routingAlias)
                  .map((m) => ({ value: m.id, label: m.id })),
              },
            ]}
          />
        )}
        <label className="composer-attach" title="Attach files (images or text)">
          <Paperclip size={13} />
          <input
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        {liveTaskId ? (
          <GlassButton
            className="primary send stop btn-glass glass"
            onClick={() => {
              if (confirm('End the running task?')) void taskAction(liveTaskId, 'cancel');
            }}
            title="End task — stop the agent and mark it cancelled"
          >
            <Square size={12} />
            <span className="send-label">End task</span>
          </GlassButton>
        ) : (
          <GlassButton
            className={`primary send${busy ? ' thinking' : ''} btn-glass glass`}
            disabled={!text.trim() || busy}
            onClick={send}
            title={
              mode === 'agent'
                ? 'Run agent task'
                : mode === 'plan'
                  ? 'Generate plan'
                  : 'Send question'
            }
          >
            {busy ? <Square size={12} /> : <Send size={12} />}
            <span className="send-label">
              {busy
                ? 'Working…'
                : mode === 'agent'
                  ? 'Run Agent'
                  : mode === 'plan'
                    ? 'Plan'
                    : 'Send'}
            </span>
          </GlassButton>
        )}
      </div>
    </div>
  );
}
