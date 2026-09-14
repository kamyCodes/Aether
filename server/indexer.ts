import fsp from 'node:fs/promises';
/**
 * ProjectIndexer — codebase search index (MiniSearch) for the search panel
 * and agent context gathering. Rebuilds incrementally on FS change events.
 */
import path from 'node:path';
import MiniSearch from 'minisearch';
import type { WorkspaceManager } from './workspace.js';
import { countTokens } from './tokens.js';

export interface IndexedSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'const' | 'interface' | 'type' | 'component' | 'other';
  path: string;
  line: number;
}

export interface IndexedFile {
  path: string;
  tokens: number;
  lang: string;
  symbols: IndexedSymbol[];
  imports: string[];
}

const SYM_RE: { re: RegExp; kind: IndexedSymbol['kind'] }[] = [
  { re: /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g, kind: 'function' },
  { re: /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g, kind: 'class' },
  { re: /export\s+interface\s+([A-Za-z0-9_$]+)/g, kind: 'interface' },
  { re: /export\s+type\s+([A-Za-z0-9_$]+)/g, kind: 'type' },
  { re: /export\s+const\s+([A-Za-z0-9_$]+)/g, kind: 'const' },
  { re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm, kind: 'function' },
  { re: /^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/gm, kind: 'class' },
  { re: /def\s+([A-Za-z0-9_]+)\s*\(/g, kind: 'function' },
  { re: /class\s+([A-Za-z0-9_]+)/g, kind: 'class' },
  { re: /func\s+([A-Za-z0-9_]+)/g, kind: 'function' },
];

const IMPORT_RE =
  /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|from\s+([.\w]+)\s+import|require\(\s*['"]([^'"]+)['"]\s*\))/g;

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.md': 'markdown',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.sql': 'sql',
  '.sh': 'shell',
  '.yml': 'yaml',
  '.yaml': 'yaml',
};

export function langForFile(p: string): string {
  return LANG_BY_EXT[path.extname(p)] ?? 'text';
}

/** Incremental in-memory project index: full-text + symbols + imports + token counts. */
export class ProjectIndexer {
  private files = new Map<string, IndexedFile>();
  private search = new MiniSearch<IndexedFile>({
    idField: 'id',
    fields: ['path', 'content'],
    storeFields: ['path'],
  });
  private contentCache = new Map<string, string>();
  workspaceId = '';
  ready = false;
  fileCount = 0;

  constructor(private ws: WorkspaceManager) {}

  async index(workspaceId: string, changedOnly = false) {
    this.workspaceId = workspaceId;
    const all = await this.ws.listFiles(workspaceId);
    const codeExts = new Set(Object.keys(LANG_BY_EXT));
    let count = 0;
    for (const rel of all) {
      if (count >= 2000) break;
      const ext = path.extname(rel);
      if (!codeExts.has(ext)) continue;
      if (changedOnly && this.files.has(rel)) continue;
      try {
        const stat = await fsp.stat(path.join(this.ws.require(workspaceId).root, rel));
        if (stat.size > 400_000) continue;
        const content = await this.ws.readFile(workspaceId, rel);
        this.contentCache.set(rel, content);
        const symbols = extractSymbols(content, rel);
        const imports = extractImports(content);
        const prev = this.files.get(rel);
        const entry: IndexedFile = {
          path: rel,
          tokens: countTokens(content),
          lang: langForFile(rel),
          symbols,
          imports,
        };
        this.files.set(rel, entry);
        // MiniSearch keys documents by a unique `id` field — without it every
        // document collides on `undefined` and search silently returns nothing.
        // Discard by ID (not by document object) before re-adding on refresh.
        if (prev) this.search.discard(rel);
        this.search.add({ id: rel, ...entry, content } as IndexedFile & {
          id: string;
          content: string;
        });
        count++;
      } catch {
        /* unreadable */
      }
    }
    this.fileCount = this.files.size;
    this.ready = true;
    return this.fileCount;
  }

  async onFileChanged(rel: string) {
    if (!this.files.has(rel) && !this.ready) return;
    await this.index(this.workspaceId, true);
  }

  fuzzySearch(query: string, limit = 30): { path: string; score: number }[] {
    const q = query.trim();
    if (!q) return [];
    const results = this.search.search(q, { fuzzy: 0.2, prefix: true }).slice(0, limit);
    return results.map((r) => ({ path: (r.path as string) ?? r.id, score: r.score }));
  }

  searchSymbols(query: string, limit = 50): IndexedSymbol[] {
    const q = query.toLowerCase();
    const out: IndexedSymbol[] = [];
    for (const f of this.files.values()) {
      for (const s of f.symbols) {
        if (s.name.toLowerCase().includes(q)) out.push(s);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  findUsages(symbol: string, limit = 80): { path: string; line: number; text: string }[] {
    const out: { path: string; line: number; text: string }[] = [];
    for (const [p, content] of this.contentCache) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && out.length < limit; i++) {
        if (lines[i].includes(symbol))
          out.push({ path: p, line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
    return out;
  }

  getCodebaseMap(maxFiles = 60): string {
    const dirs = new Map<string, string[]>();
    for (const f of this.files.keys()) {
      const dir = path.dirname(f);
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(path.basename(f));
    }
    const lines: string[] = [`Codebase map (${this.files.size} indexed files):`];
    let n = 0;
    for (const [dir, files] of dirs) {
      lines.push(
        `${dir}/: ${files.slice(0, 12).join(', ')}${files.length > 12 ? ` +${files.length - 12} more` : ''}`,
      );
      if (++n >= maxFiles) break;
    }
    return lines.join('\n');
  }

  dependencyGraph(limit = 40): { from: string; to: string }[] {
    const edges: { from: string; to: string }[] = [];
    for (const f of this.files.values()) {
      for (const imp of f.imports.slice(0, 8)) {
        if (!imp.startsWith('.')) continue;
        const resolved = resolveImport(f.path, imp);
        if (resolved) edges.push({ from: f.path, to: resolved });
      }
      if (edges.length >= limit) break;
    }
    return edges;
  }

  /** Pick the most relevant files for a query (filename match > symbol match > fuzzy). */
  relevantFiles(query: string, cap = 12): string[] {
    const q = query.toLowerCase();
    const scored = new Map<string, number>();
    for (const [p, content] of this.contentCache) {
      let score = 0;
      const lower = path.basename(p).toLowerCase();
      if (q.split(/\s+/).some((w) => w.length > 2 && lower.includes(w))) score += 10;
      for (const s of this.files.get(p)?.symbols ?? []) {
        if (s.name.toLowerCase().includes(q.slice(0, 24))) score += 5;
      }
      const occurrences = content.toLowerCase().split(q.slice(0, 20)).length - 1;
      if (q.length > 8 && occurrences > 0) score += Math.min(6, occurrences);
      if (score > 0) scored.set(p, score);
    }
    return [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([p]) => p);
  }

  getTokensFor(rel: string): number {
    return this.files.get(rel)?.tokens ?? 0;
  }

  stats() {
    return {
      files: this.files.size,
      ready: this.ready,
      symbols: [...this.files.values()].reduce((a, f) => a + f.symbols.length, 0),
    };
  }
}

function extractSymbols(content: string, rel: string): IndexedSymbol[] {
  const out: IndexedSymbol[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && out.length < 200; i++) {
    const line = lines[i];
    for (const { re, kind } of SYM_RE) {
      re.lastIndex = 0;
      let m = re.exec(line);
      if (m && m[1]) {
        out.push({ name: m[1], kind, path: rel, line: i + 1 });
        break;
      }
    }
  }
  return dedupe(out);
}

function extractImports(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) && out.length < 100) {
    const src = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (src) out.push(src);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.join(path.dirname(from), spec);
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
    return base + ext; // optimistic: the graph is best-effort
  }
  return null;
}

function dedupe(syms: IndexedSymbol[]): IndexedSymbol[] {
  const seen = new Set<string>();
  return syms.filter((s) => {
    const k = `${s.kind}:${s.name}:${s.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
