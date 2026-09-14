import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import picomatch from 'picomatch';
import chokidar from 'chokidar';
import type { FileChangeEvent, FileNode, WorkspaceInfo } from '../shared/types.js';
import { countTokens } from './tokens.js';
import { DATA_DIR } from './dataDir.js';

/** Manages registered workspaces, fs operations, watching, and ignore rules. */
export class WorkspaceManager extends EventEmitter {
  workspaces = new Map<string, WorkspaceInfo & { root: string }>();
  private watchers = new Map<string, import('chokidar').FSWatcher>();
  private ignoreMatchers = new Map<string, (p: string) => boolean>();

  private dataDir = DATA_DIR;

  constructor() {
    super();
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  settingsPath = () => path.join(this.dataDir, 'settings.json');
  skillsDir = () => path.join(this.dataDir, 'skills');
  indexDir = () => path.join(this.dataDir, 'index');
  private registryPath = () => path.join(this.dataDir, 'workspaces.json');

  /** Persist the open-workspace registry so it survives backend restarts.
   *  Atomic: write to a temp file in the same directory, then rename over
   *  the target, so a crash mid-write can never truncate/corrupt the JSON
   *  (audit Section 9: two concurrent instances must not produce garbage). */
  private persistRegistry() {
    try {
      const target = this.registryPath();
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      const entries = [...this.workspaces.values()].map((w) => ({ root: w.root, name: w.name }));
      fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
      fs.renameSync(tmp, target);
    } catch { /* best effort */ }
  }

  /** Re-open workspaces from ~/.aether/workspaces.json on boot (skips missing dirs).
   *  Returns how many were successfully restored. */
  async restoreRegistry(): Promise<number> {
    let restored = 0;
    try {
      const entries = JSON.parse(fs.readFileSync(this.registryPath(), 'utf8')) as { root: string; name?: string }[];
      for (const e of entries) {
        try { await this.addWorkspace(e.root, e.name); restored++; } catch { /* directory gone since last run */ }
      }
    } catch { /* no registry file yet */ }
    return restored;
  }

  ensureDirs() {
    fs.mkdirSync(this.skillsDir(), { recursive: true });
    fs.mkdirSync(this.indexDir(), { recursive: true });
  }

  private readIgnore(root: string): (p: string) => boolean {
    const positives: string[] = [
      'node_modules/**', 'node_modules', '.git/**', '.git', 'dist/**', 'dist', 'build/**', 'build', 'out/**', 'out',
      '.next/**', '.next', '.cache/**', 'coverage/**', '__pycache__/**', '__pycache__', '.venv/**', '.venv',
    ];
    const negatives: string[] = [];
    try {
      const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      for (const line of gi.split(/\r?\n/)) {
        const l = line.trim();
        if (!l || l.startsWith('#')) continue;
        // Also ignore the directory itself, not just its contents
        if (l.endsWith('/**')) positives.push(l.slice(0, -3));
        if (l.startsWith('!')) negatives.push(l.slice(1));
        else positives.push(l);
      }
    } catch { /* none */ }
    // Match positives and negatives separately: passing negation patterns
    // into a single picomatch() call inverts the matcher's semantics and
    // wrongly ignores every path that doesn't match anything.
    const pos = picomatch(positives, { dot: true });
    const neg = negatives.length ? picomatch(negatives, { dot: true }) : null;
    return (p: string) => pos(p) && !(neg && neg(p));
  }

  setIgnore(root: string) {
    this.ignoreMatchers.set(root, this.readIgnore(root));
  }

  isIgnored(root: string, rel: string) {
    const m = this.ignoreMatchers.get(root);
    if (!m) {
      const mm = this.readIgnore(root);
      this.ignoreMatchers.set(root, mm);
      return mm(rel);
    }
    return m(rel);
  }

  async addWorkspace(root: string, name?: string): Promise<WorkspaceInfo> {
    const abs = path.resolve(root);
    await fsp.access(abs);
    const id = Buffer.from(abs).toString('base64url');
    if (this.workspaces.has(id)) return this.workspaces.get(id)!;
    const info: WorkspaceInfo & { root: string } = {
      id,
      name: name ?? path.basename(abs),
      root: abs,
      indexed: false,
      git: fs.existsSync(path.join(abs, '.git')),
      fileCount: 0,
    };
    this.workspaces.set(id, info);
    this.setIgnore(abs);
    this.startWatcher(id);
    this.emit('workspace:added', info);
    this.persistRegistry();
    return info;
  }

  /** Remove a workspace: stops its watcher and updates the persisted registry. */
  removeWorkspace(id: string) {
    const watcher = this.watchers.get(id);
    if (watcher) { void watcher.close(); this.watchers.delete(id); }
    this.workspaces.delete(id);
    this.persistRegistry();
  }

  get(id: string) {
    return this.workspaces.get(id);
  }

  require(id: string) {
    const ws = this.workspaces.get(id);
    if (!ws) throw new Error(`Unknown workspace: ${id}`);
    return ws;
  }

  list(): WorkspaceInfo[] {
    return [...this.workspaces.values()];
  }

  /** Start a chokidar watcher emitting FileChangeEvent over the event bus. */
  startWatcher(id: string) {
    if (this.watchers.has(id)) return;
    const ws = this.require(id);
    const ignored = this.readIgnore(ws.root);
    const watcher = chokidar.watch(ws.root, {
      ignored: (p: string) => {
        const rel = path.relative(ws.root, p);
        if (!rel || rel === '') return false;
        return rel.startsWith('..') || ignored(rel.split(path.sep).join('/'));
      },
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      depth: 20,
    });
    watcher.on('all', (ev: string, p: string) => {
      const rel = path.relative(ws.root, p).split(path.sep).join('/');
      if (!rel) return;
      const change: FileChangeEvent = { workspaceId: id, path: rel, type: ev as FileChangeEvent['type'] };
      this.emit('fs:change', change);
    });
    this.watchers.set(id, watcher);
  }

  /** Recursive file tree (bounded depth & entries for performance). */
  async tree(id: string, maxDepth = 12, maxEntries = 4000): Promise<FileNode> {
    const ws = this.require(id);
    const build = async (rel: string, depth: number): Promise<FileNode> => {
      const abs = path.join(ws.root, rel);
      const name = rel ? path.basename(rel) : path.basename(ws.root);
      let entries: fs.Dirent[] = [];
      try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { /* perm */ }
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      const children: FileNode[] = [];
      let count = 0;
      for (const e of entries) {
        if (count >= 200 || children.length >= maxEntries) break;
        const crel = rel ? `${rel}/${e.name}` : e.name;
        if (this.isIgnored(ws.root, crel)) continue;
        if (e.isDirectory()) {
          if (depth < maxDepth) {
            children.push(await build(crel, depth + 1));
            count++;
          }
        } else {
          let size: number | undefined;
          try { size = (await fsp.stat(path.join(ws.root, crel))).size; } catch { /* gone */ }
          children.push({ name: e.name, path: crel, type: 'file', size });
          count++;
        }
      }
      return { name, path: rel, type: 'dir', children };
    };
    return build('', 0);
  }

  async readFile(id: string, rel: string): Promise<string> {
    const ws = this.require(id);
    const abs = this.safeJoin(ws.root, rel);
    return fsp.readFile(abs, 'utf8');
  }

  async writeFile(id: string, rel: string, content: string) {
    const ws = this.require(id);
    const abs = this.safeJoin(ws.root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
    this.emit('fs:change', { workspaceId: id, path: rel, type: 'change' } as FileChangeEvent);
  }

  async deleteFile(id: string, rel: string) {
    const ws = this.require(id);
    await fsp.rm(this.safeJoin(ws.root, rel), { recursive: true });
    this.emit('fs:change', { workspaceId: id, path: rel, type: 'unlink' } as FileChangeEvent);
  }

  async rename(id: string, from: string, to: string) {
    const ws = this.require(id);
    await fsp.mkdir(path.dirname(path.join(ws.root, to)), { recursive: true });
    await fsp.rename(this.safeJoin(ws.root, from), this.safeJoin(ws.root, to));
    this.emit('fs:change', { workspaceId: id, path: to, type: 'add' } as FileChangeEvent);
  }

  safeJoin(root: string, rel: string): string {
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Path escapes workspace: ${rel}`);
    return abs;
  }

  /** List workspace files (flat, relative paths) up to a cap — used by indexer & context manager. */
  async listFiles(id: string, cap = 5000): Promise<string[]> {
    const ws = this.require(id);
    const out: string[] = [];
    const walk = async (rel: string) => {
      if (out.length >= cap) return;
      let entries: fs.Dirent[] = [];
      try { entries = await fsp.readdir(path.join(ws.root, rel || '.'), { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= cap) return;
        const crel = rel ? `${rel}/${e.name}` : e.name;
        if (this.isIgnored(ws.root, crel)) continue;
        if (e.isDirectory()) await walk(crel);
        else out.push(crel);
      }
    };
    await walk('');
    return out;
  }

  async estimateTokensForFile(id: string, rel: string): Promise<number> {
    try {
      const content = await this.readFile(id, rel);
      return countTokens(content);
    } catch {
      return 0;
    }
  }

  closeAll() {
    for (const w of this.watchers.values()) void w.close();
    this.watchers.clear();
  }
}
