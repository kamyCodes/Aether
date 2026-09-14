import React, { useMemo, useState } from 'react';
import { Check, Circle, Download, FilePlus2, FolderOpen, Package, Pencil, Search, Trash2, Zap } from 'lucide-react';
import { useStore } from '../lib/store';
import { alertDialog } from '../lib/dialogs';
import type { Skill } from '../../shared/types';

export function SkillsPanel() {
  const skills = useStore((s) => s.skills);
  const toggleSkill = useStore((s) => s.toggleSkill);
  const saveSkill = useStore((s) => s.saveSkill);
  const deleteSkill = useStore((s) => s.deleteSkill);
  const workspaceName = useStore((s) => s.workspaces.find((w) => w.id === s.workspaceId)?.name);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState('');

  // Categories from pack provenance + a synthetic bucket for unpackaged skills.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of skills) set.add(s.packCategory ?? 'core');
    return ['all', ...[...set].sort()];
  }, [skills]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (category !== 'all' && (s.packCategory ?? 'core') !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.packTags?.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [skills, query, category]);

  const enabledCount = skills.filter((s) => s.enabled).length;

  const importPack = async (overwrite: boolean) => {
    setImporting(true);
    setImportNote('');
    try {
      const r = await fetch('/api/skills/import-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setImportNote(`Imported ${body.imported} skill${body.imported === 1 ? '' : 's'}${body.skipped ? ` · ${body.skipped} already installed` : ''}`);
      await useStore.getState().refreshSkills();
    } catch (e) {
      void alertDialog('Skill pack import failed', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const exportSkill = (s: Skill) => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${s.id}.skill.json`;
    a.click();
  };

  const importSkill = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        try { await saveSkill(JSON.parse(await file.text()) as Skill); } catch (e) { void alertDialog('Invalid skill file', e instanceof Error ? e.message : String(e)); }
      }
    };
    input.click();
  };

  return (
    <div className="panel-body" style={{ display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <FolderOpen size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Skills for {workspaceName ?? 'no project'}
            </span>
          </span>
          <span className="skills-count-pill">{enabledCount}/{skills.length} enabled</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={importSkill} title="Import a .skill.json file"><FilePlus2 size={12} /> Import</button>
            <button onClick={() => void importPack(false)} disabled={importing} title="Install the 75-skill Aether skill pack (existing installs untouched)">
              <Package size={12} /> {importing ? 'Importing…' : 'Import pack'}
            </button>
            <button className="primary" onClick={() => setEditing({
              id: '', name: 'New Skill', description: '', version: '1.0.0', enabled: false,
              scope: 'global', instructions: '', rules: [], priority: 50,
            })}><Pencil size={12} /> + New Skill</button>
          </div>
        </div>

        <div className="skills-toolbar">
          <div className="skills-search">
            <Search size={12} />
            <input placeholder="Search skills…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="mode-toggle" aria-label="Skill category">
            {categories.map((c) => (
              <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                {c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
            {/* Liquid Glass sliding indicator (visual only — lib/glass.ts drives it) */}
            <div className="segment-indicator"><div className="segment-indicator-fill" /></div>
          </div>
          {importNote && <span className="skills-import-note">{importNote}</span>}
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {visible.map((s) => (
            <div key={s.id} className="skill-card">
              <div className="head">
                <button
                  className={`skill-enable-dot ${s.enabled ? 'on' : ''}`}
                  onClick={() => void toggleSkill(s.id)}
                  title={s.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  aria-pressed={s.enabled}
                >
                  {s.enabled ? <Check size={11} strokeWidth={3} /> : <Circle size={8} />}
                </button>
                <strong>{s.name}</strong>
                <span className="badge">v{s.version}</span>
                {s.packCategory && <span className="badge">{s.packCategory}</span>}
                <span className="badge">priority {s.priority}</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setEditing(s)} title="Edit skill"><Pencil size={11} /></button>
                <button onClick={() => exportSkill(s)} title="Export as .skill.json"><Download size={11} /></button>
                {!s.builtin && <button className="danger" onClick={() => void deleteSkill(s.id)} title="Delete skill"><Trash2 size={11} /></button>}
              </div>
              <div className="desc">{s.description}</div>
              {s.enabled && (
                <div className="skill-invocation-hint" title="Type this in the chat composer to invoke the skill">
                  <Zap size={10} /> call in chat: <code>/{s.id}</code>
                </div>
              )}
              {s.packTags && s.packTags.length > 0 && (
                <div className="skill-tags">
                  {s.packTags.slice(0, 5).map((t) => <span key={t} className="badge">{t}</span>)}
                </div>
              )}
            </div>
          ))}
          {visible.length === 0 && (
            <div className="empty-state">
              {skills.length === 0
                ? 'No skills installed. Use "Import pack" to install the 75-skill pack.'
                : 'No skills match this search.'}
            </div>
          )}
        </div>
      </div>

      {editing && <SkillEditor skill={editing} onChange={setEditing} onSave={async () => { await saveSkill(editing); setEditing(null); }} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SkillEditor({ skill, onChange, onSave, onClose }: {
  skill: Skill;
  onChange: (s: Skill) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Skill>) => onChange({ ...skill, ...patch });
  const isNew = !skill.id;
  return (
    <div className="skill-editor">
      <div className="skill-editor-head">
        <strong>{isNew ? 'New Skill' : `Edit — ${skill.name}`}</strong>
        <button className="skill-editor-close" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="skill-editor-body">
        <label className="se-field">
          <span>Name</span>
          <input value={skill.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. TypeScript Strictness" />
        </label>

        <label className="se-field">
          <span>Description</span>
          <textarea rows={2} value={skill.description} onChange={(e) => set({ description: e.target.value })} placeholder="One line the agent sees when deciding whether the skill applies" />
        </label>

        <label className="se-field">
          <span>Instructions <em>— system-prompt fragment</em></span>
          <textarea rows={8} value={skill.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="What the agent should do when this skill is active…" />
        </label>

        <label className="se-field">
          <span>Rules <em>— one per line</em></span>
          <textarea rows={5} value={skill.rules.join('\n')} onChange={(e) => set({ rules: e.target.value.split('\n').filter(Boolean) })} placeholder={'Always run tests after edits\nNever modify lockfiles'} />
        </label>

        <label className="se-field">
          <span>Examples <em>— one per line</em></span>
          <textarea rows={3} value={(skill.examples ?? []).join('\n')} onChange={(e) => set({ examples: e.target.value.split('\n').filter(Boolean) })} placeholder="Concrete good examples the agent can imitate" />
        </label>

        <div className="se-row">
          <label className="se-field">
            <span>Version</span>
            <input value={skill.version} onChange={(e) => set({ version: e.target.value })} />
          </label>
          <label className="se-field">
            <span>Priority <em>— higher wins context</em></span>
            <input type="number" value={skill.priority} onChange={(e) => set({ priority: Number(e.target.value) })} />
          </label>
        </div>
      </div>

      <div className="skill-editor-foot">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={onSave}>{isNew ? 'Create Skill' : 'Save Changes'}</button>
      </div>
    </div>
  );
}
