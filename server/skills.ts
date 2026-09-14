import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Skill } from '../shared/types.js';

/**
 * Skill manager — skills are data, not code. The agent reads active skill
 * instructions/rules/examples at task time; adding a skill never requires
 * changing the core agent.
 *
 * Built-in skills are seeded on first run into ~/.aether/skills/.
 */
export class SkillManager {
  private dir: string;
  private cache = new Map<string, Skill>();
  /** Per-workspace enabled overrides: workspaceId → Set<skillId>. */
  private projectEnabled = new Map<string, Set<string>>();
  /** Global enabled ids — the fallback when no project override exists. */
  private globalEnabled = new Set<string>();

  constructor(skillsDir: string) {
    this.dir = skillsDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.loadEnabledState();
  }

  /** Persisted under <skillsDir>/enabled-state.json. */
  private statePath() {
    return path.join(this.dir, 'enabled-state.json');
  }

  private loadEnabledState() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath(), 'utf8')) as {
        global?: string[];
        projects?: Record<string, string[]>;
      };
      this.globalEnabled = new Set(raw.global ?? []);
      for (const [wsId, ids] of Object.entries(raw.projects ?? {})) {
        this.projectEnabled.set(wsId, new Set(ids));
      }
    } catch { /* first run — defaults */ }
  }

  private persistEnabledState() {
    try {
      const projects: Record<string, string[]> = {};
      for (const [wsId, ids] of this.projectEnabled) projects[wsId] = [...ids];
      fs.writeFileSync(this.statePath(), JSON.stringify({ global: [...this.globalEnabled], projects }, null, 2));
    } catch { /* best effort */ }
  }

  /**
   * Enabled skills as seen from a workspace. Per-project sets override the
   * global one: enabling/disabling a skill for a project never leaks into
   * other projects. With no workspaceId, global state applies.
   */
  async enabledFor(workspaceId?: string): Promise<Skill[]> {
    const all = await this.loadAll();
    const projectSet = workspaceId ? this.projectEnabled.get(workspaceId) : undefined;
    const enabledIds = projectSet ?? this.globalEnabled;
    return all.filter((s) => enabledIds.has(s.id));
  }

  /** Toggle a skill for a scope; per-project toggles are isolated per folder. */
  async setEnabledFor(id: string, enabled: boolean, workspaceId?: string | null) {
    if (workspaceId) {
      const set = this.projectEnabled.get(workspaceId) ?? new Set<string>(this.globalEnabled);
      if (enabled) set.add(id);
      else set.delete(id);
      this.projectEnabled.set(workspaceId, set);
    } else {
      if (enabled) this.globalEnabled.add(id);
      else this.globalEnabled.delete(id);
      // Mirror the change into every project that has no override yet, so
      // global flips stay visible until the user customizes a project.
      for (const [, set] of this.projectEnabled) {
        if (enabled) set.add(id); else set.delete(id);
      }
    }
    this.persistEnabledState();
  }

  private fileFor(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  async loadAll(): Promise<Skill[]> {
    try {
      const files = await fsp.readdir(this.dir);
      const skills: Skill[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const s = JSON.parse(await fsp.readFile(path.join(this.dir, f), 'utf8')) as Skill;
          this.cache.set(s.id, s);
          skills.push(s);
        } catch { /* corrupt skill skipped */ }
      }
      return skills.sort((a, b) => b.priority - a.priority);
    } catch {
      return [];
    }
  }

  async save(skill: Skill): Promise<Skill> {
    const id = skill.id || nanoid(10);
    const s = { ...skill, id };
    await fsp.writeFile(this.fileFor(id), JSON.stringify(s, null, 2));
    this.cache.set(id, s);
    return s;
  }

  async remove(id: string) {
    await fsp.rm(this.fileFor(id), { force: true });
    this.cache.delete(id);
  }

  get(id: string) {
    return this.cache.get(id);
  }

  async setEnabled(id: string, enabled: boolean) {
    const s = this.cache.get(id);
    if (s) await this.save({ ...s, enabled });
  }
  /** Seed built-in skills on first run (idempotent). */
  async seedBuiltins() {
    const existing = await this.loadAll();
    const have = new Set(existing.map((s) => s.id));
    for (const b of BUILTIN_SKILLS) {
      if (!have.has(b.id)) await this.save(b);
    }
  }

  /**
   * Import skills from a skill pack directory (e.g. Aether-Skill-Pack/):
   * reads skills-manifest.json and converts each entry's markdown into a
   * persisted Skill JSON. Idempotent — existing ids are left untouched
   * unless `overwrite` is set, so user edits survive re-imports. Imported
   * skills are DISABLED by default; the user opts in per skill.
   * Returns { imported, skipped, total }.
   */
  async importPack(packDir: string, overwrite = false): Promise<{ imported: number; skipped: number; total: number }> {
    const manifestPath = path.join(packDir, 'skills-manifest.json');
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as {
      skills: Record<string, { name: string; file: string; category?: string; trigger?: string; summary?: string; tags?: string[] }>;
    };
    const entries = Object.entries(manifest.skills ?? {});
    const existing = new Set((await this.loadAll()).map((s) => s.id));

    let imported = 0;
    let skipped = 0;
    for (const [id, meta] of entries) {
      if (existing.has(id) && !overwrite) { skipped++; continue; }
      let markdown = '';
      try { markdown = await fsp.readFile(path.join(packDir, meta.file), 'utf8'); } catch { /* missing file → still import metadata */ }

      // Split markdown body from a `--- name/description ---` frontmatter
      // header when present (the skills/ dir entries use it).
      let body = markdown;
      let fmName = '';
      let fmDesc = '';
      const fm = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
      if (fm) {
        body = markdown.slice(fm[0].length);
        for (const line of fm[1].split('\n')) {
          const m = line.match(/^(\w+):\s*(.+)$/);
          if (m?.[1] === 'name') fmName = m[2].trim();
          if (m?.[1] === 'description') fmDesc = m[2].trim();
        }
      }

      const skill: Skill = {
        id,
        name: fmName || meta.name || id,
        description: fmDesc || meta.summary || meta.trigger || '',
        version: '1.0.0',
        enabled: false,
        builtin: true, // pack skills re-import (are repairable) but can't be deleted lightly — same semantics as built-ins
        scope: 'global',
        instructions: body.trim(),
        rules: [],
        examples: [],
        tools: [],
        priority: 40,
      };
      // stash pack metadata the UI can surface
      const extra: Record<string, unknown> = {};
      if (meta.category) extra.packCategory = meta.category;
      if (meta.tags?.length) extra.packTags = meta.tags;
      await this.save(Object.assign(skill, extra) as Skill);
      imported++;
    }
    return { imported, skipped, total: entries.length };
  }

  /** Compose the system-prompt fragment from enabled skills, highest priority first. */
  composeSystemFragment(enabledSkills: Skill[]): string {
    if (!enabledSkills.length) return '';
    const parts: string[] = ['The following SKILLS are active for this task. Follow their instructions when relevant.'];
    for (const s of enabledSkills) {
      parts.push(
        `\n=== SKILL: ${s.name} (v${s.version}) ===\n` +
          `${s.description}\n` +
          (s.instructions ? `\nInstructions:\n${s.instructions}\n` : '') +
          (s.rules?.length ? `\nRules:\n${s.rules.map((r) => `- ${r}`).join('\n')}\n` : '') +
          (s.examples?.length ? `\nExamples:\n${s.examples.join('\n')}\n` : ''),
      );
    }
    return parts.join('\n');
  }
}

const APPLE_DESIGN: Skill = {
  id: 'apple-design',
  name: 'Apple Design',
  description:
    'Applies Apple-style design language to generated and modified interfaces: clarity, deference, depth, and fluidity.',
  version: '1.0.0',
  enabled: false,
  builtin: true,
  scope: 'global',
  priority: 100,
  tools: [],
  instructions:
    'When creating or modifying user interfaces, apply Apple Human Interface design language:\n' +
    '- Prioritize clear visual hierarchy: prominent titles, supporting secondary text, generous whitespace.\n' +
    '- Typography: use system font stacks (e.g. -apple-system, SF Pro style); strong type scale with semibold headings.\n' +
    '- Spacing: consistent 4/8pt grid; comfortable padding; rounded corners (8-16px) on surfaces.\n' +
    '- Materials: prefer translucent/frosted surfaces (backdrop-filter blur) for overlays, sidebars and chrome.\n' +
    '- Depth: subtle shadows and layered elevation instead of hard borders.\n' +
    '- Motion: fluid, purposeful animations (150-350ms ease-out); respect prefers-reduced-motion.\n' +
    '- Native feel: familiar controls (toggles, segmented controls), keyboard focus rings, ESC to dismiss.\n' +
    '- Accessibility: minimum contrast ratios, dynamic type support, touch targets >= 44px, full keyboard navigation.\n' +
    '- Responsive: layouts adapt gracefully from mobile to desktop.\n' +
    '- Minimalism: remove decorative noise; every element must earn its place.',
  rules: [
    'Use system font stacks and avoid more than two type families',
    'Spacing must follow a 4/8pt grid',
    'Interactive elements need visible hover/active/focus states with subtle transitions',
    'Prefer translucency (blur materials) for navigation chrome and overlays',
    'Colors: restrained palette; use accent color sparingly for primary actions',
    'All controls must meet WCAG AA contrast',
    'No layout shift on load; animations must not block interaction',
  ],
  examples: [
    'Sidebar: `backdrop-filter: blur(20px); background: rgba(255,255,255,0.6); border-radius: 12px;`',
    'Primary button: solid accent, 8px radius, 200ms ease transform on hover (scale 1.02), focus ring.',
  ],
  resources: [
    {
      name: 'hig-checklist',
      content:
        'Clarity: text legible at every size, icons precise. Deference: UI helps content, never competes. Depth: motion and layering communicate hierarchy.',
    },
  ],
};

const REACT_EXPERT: Skill = {
  id: 'react-expert',
  name: 'React Expert',
  description: 'Modern React best practices: hooks, composition, performance, typed components.',
  version: '1.0.0',
  enabled: false,
  builtin: true,
  scope: 'global',
  priority: 80,
  tools: [],
  instructions:
    'Write modern React (function components + hooks). Prefer composition over configuration. ' +
    'Colocate state, lift only when shared. Use TypeScript types for props. Memoize expensive computations. ' +
    'Use semantic HTML and ARIA roles. Avoid prop drilling with context when appropriate.',
  rules: [
    'Function components only; no class components unless required',
    'Props and state fully typed',
    'Extract components above ~150 lines',
    'Effects must have cleanup where needed',
  ],
};

const FASTAPI_EXPERT: Skill = {
  id: 'fastapi-expert',
  name: 'FastAPI Expert',
  description: 'Python FastAPI backend best practices: routers, pydantic models, async DB access.',
  version: '1.0.0',
  enabled: false,
  builtin: true,
  scope: 'global',
  priority: 70,
  tools: [],
  instructions:
    'Use FastAPI with APIRouter per domain. Validate all inputs with pydantic v2 models. ' +
    'Use async endpoints and async DB drivers. Return typed response models. Add OpenAPI tags and descriptions.',
  rules: ['No raw SQL string interpolation — use parameterized queries or ORM', 'Every endpoint has a response_model', 'Errors via HTTPException with clear detail'],
};

const DB_ENGINEER: Skill = {
  id: 'db-engineer',
  name: 'Database Engineer',
  description: 'Schema design, migrations, indexing and query optimization.',
  version: '1.0.0',
  enabled: false,
  builtin: true,
  scope: 'global',
  priority: 60,
  tools: [],
  instructions:
    'Design normalized schemas with explicit primary/foreign keys. Add indexes for frequent queries. ' +
    'Prefer migrations over manual edits. Include created_at/updated_at timestamps. Document every table.',
  rules: ['Every FK has an index', 'No SELECT * in application code', 'Migrations are reversible'],
};

const SECURITY_AUDITOR: Skill = {
  id: 'security-auditor',
  name: 'Security Auditor',
  description: 'Reviews code for vulnerabilities: injection, auth flaws, secret leaks, unsafe deps.',
  version: '1.0.0',
  enabled: false,
  builtin: true,
  scope: 'global',
  priority: 90,
  tools: [],
  instructions:
    'When reviewing or writing code, check: input validation, output encoding, auth/authz on every route, ' +
    'secret management (never hardcode), dependency vulnerabilities, CORS/headers, and logging of security events.',
  rules: ['Never commit secrets; use environment variables', 'Escape all user output', 'Deny by default on authorization checks'],
};

export const BUILTIN_SKILLS: Skill[] = [APPLE_DESIGN, REACT_EXPERT, FASTAPI_EXPERT, DB_ENGINEER, SECURITY_AUDITOR];
