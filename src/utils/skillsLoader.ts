/**
 * Skills loader — reads Aether-Skill-Pack/skills-manifest.json and returns the
 * full markdown content of selected skills, ready to concatenate into task
 * context. Pure functions; manifest is fetched once and cached.
 *
 * Two surfaces:
 *  - loadSkills({ category?, ids? }) → string (markdown blob for a prompt)
 *  - listSkills(filter?) → manifest metadata (for pickers/UI)
 */
import type { Skill } from '../../shared/types';

interface ManifestSkill {
  name: string;
  file: string;
  category: string;
  trigger: string;
  summary: string;
  tags: string[];
}

interface Manifest {
  categories: Record<string, { label: string; skills: string[] }>;
  skills: Record<string, ManifestSkill>;
}

let manifestCache: Manifest | null = null;

/** Fetch (and cache) the manifest. Works in dev (served from project root) and via API. */
export async function getManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch('/api/skills-pack/manifest');
  if (!res.ok) throw new Error(`skills manifest unavailable: ${res.status}`);
  manifestCache = (await res.json()) as Manifest;
  return manifestCache;
}

/** Metadata list for pickers/UI. Filter by category and/or text query. */
export async function listSkills(filter?: { category?: string; query?: string }): Promise<(ManifestSkill & { id: string })[]> {
  const m = await getManifest();
  let all = Object.entries(m.skills).map(([id, s]) => ({ id, ...s }));
  if (filter?.category) all = all.filter((s) => s.category === filter.category);
  if (filter?.query) {
    const q = filter.query.toLowerCase();
    all = all.filter((s) => s.name.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q) || s.tags.some((t) => t.includes(q)));
  }
  return all;
}

/**
 * Resolve the skill ids to load: explicit ids, or every skill in a category,
 * or both (union). Unknown ids are reported via onMissing rather than thrown.
 */
export async function resolveSkillIds(sel: { category?: string | string[]; ids?: string[] }): Promise<string[]> {
  const m = await getManifest();
  const out = new Set<string>();
  const cats = sel.category ? (Array.isArray(sel.category) ? sel.category : [sel.category]) : [];
  for (const c of cats) for (const id of m.categories[c]?.skills ?? []) out.add(id);
  for (const id of sel.ids ?? []) if (m.skills[id]) out.add(id);
  return [...out];
}

/** Load the full markdown of one skill file via the backend file API. */
async function loadSkillFile(relPath: string): Promise<string> {
  const res = await fetch(`/api/skills-pack/file?path=${encodeURIComponent(relPath)}`);
  if (!res.ok) throw new Error(`skill file unavailable: ${relPath} (${res.status})`);
  const { content } = (await res.json()) as { content: string };
  return content;
}

/**
 * Load selected skills and concatenate their full markdown, with per-skill
 * headers so the agent can see where each skill's instructions begin.
 */
export async function loadSkills(sel: { category?: string | string[]; ids?: string[] }, onProgress?: (id: string, i: number, n: number) => void): Promise<string> {
  const m = await getManifest();
  const ids = await resolveSkillIds(sel);
  const parts: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const meta = m.skills[id];
    onProgress?.(id, i + 1, ids.length);
    try {
      const body = await loadSkillFile(meta.file);
      parts.push(`<!-- skill: ${id} (${meta.category}) | ${meta.summary} -->\n\n${body}`);
    } catch {
      parts.push(`<!-- skill: ${id} — FAILED TO LOAD (${meta.file}) -->`);
    }
  }
  if (!parts.length) return '';
  return `# Active skills (${ids.length})\n\n${parts.join('\n\n---\n\n')}`;
}

/** Convenience: convert manifest entries into the app's existing Skill records. */
export function toAppSkills(entries: (ManifestSkill & { id: string })[]): Skill[] {
  return entries.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.summary,
    version: '1.0.0',
    enabled: false,
    builtin: true,
    scope: 'global' as const,
    instructions: '',
    rules: [],
    tags: e.tags,
    priority: 5,
  }));
}
