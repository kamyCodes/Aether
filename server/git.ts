import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as git from 'isomorphic-git';
import type { FileDiff, DiffHunk } from '../shared/types.js';
import { diffLines } from 'diff';

/** Git manager built on isomorphic-git — works without a git CLI install. */
export class GitManager {
  async status(root: string) {
    const matrix = await git.statusMatrix({ fs, dir: root });
    const files = matrix
      .filter(([, head, workdir, stage]) => !(Number(head) === 1 && Number(workdir) === 1 && Number(stage) === 1))
      .map(([file, headV, workdir]) => ({
        path: file,
        status: Number(workdir) === 0 ? 'deleted' : Number(headV) === 0 ? 'added' : 'modified',
        staged: false,
      }));
    const branches = await git.listBranches({ fs, dir: root });
    const current = await git.currentBranch({ fs, dir: root });
    return { files, branches, current: current ?? '' };
  }

  async diff(root: string, relPath: string): Promise<FileDiff> {
    const abs = path.join(root, relPath);
    let old = '';
    let status: FileDiff['status'] = 'modified';
    try {
      const commit = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
      const blob = await git.readBlob({ fs, dir: root, oid: commit, filepath: relPath }).catch(() => null);
      if (blob) old = Buffer.from(blob.blob).toString('utf8');
      else status = 'added';
    } catch {
      status = 'added';
    }
    let neu = '';
    try {
      neu = await fsp.readFile(abs, 'utf8');
    } catch {
      status = 'deleted';
    }
    return buildFileDiff(relPath, status, old, neu);
  }

  async add(root: string, relPath: string) {
    await git.add({ fs, dir: root, filepath: relPath });
  }

  async addAll(root: string, files: string[]) {
    for (const f of files) {
      try {
        await git.add({ fs, dir: root, filepath: f });
      } catch {
        /* deleted file */
        try { await git.remove({ fs, dir: root, filepath: f }); } catch { /* ignore */ }
      }
    }
  }

  async commit(root: string, message: string, author = { name: 'Aether', email: 'agent@aether.local' }) {
    const sha = await git.commit({ fs, dir: root, message, author });
    return sha;
  }

  async log(root: string, depth = 50) {
    try {
      const commits = await git.log({ fs, dir: root, depth });
      return commits.map((c) => ({
        oid: c.oid,
        message: c.commit.message,
        author: c.commit.author.name,
        timestamp: c.commit.author.timestamp * 1000,
      }));
    } catch {
      return [];
    }
  }

  async branch(root: string, name: string, checkout = true) {
    await git.branch({ fs, dir: root, ref: name, checkout });
  }

  async checkout(root: string, ref: string) {
    await git.checkout({ fs, dir: root, ref });
  }

  async init(root: string) {
    await git.init({ fs, dir: root });
  }
}

/** Unified-diff builder used by proposals, git diff views and the UI. */
export function buildFileDiff(relPath: string, status: FileDiff['status'], oldC: string, newC: string): FileDiff {
  const parts = diffLines(oldC, newC);
  const hunks: DiffHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  let current: DiffHunk | null = null;
  const CONTEXT = 3;
  let pendingCtx: DiffHunk['lines'] = [];

  const flushHunk = () => {
    if (current && current.lines.length) hunks.push(current);
    current = null;
  };
  const startHunk = () => {
    if (!current) current = { header: `@@ ${relPath} @@`, lines: [] };
  };
  void startHunk;

  for (const part of parts) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    const count = part.value.endsWith('\n') || part.value === '' ? lines.length : lines.length;
    void count;
    if (part.added) {
      if (!current) current = { header: `@@ ${relPath} @@`, lines: [] };
      for (const ctx of pendingCtx) { current.lines.push(ctx); }
      pendingCtx = [];
      for (const l of lines) {
        current!.lines.push({ type: 'add', old: -1, new: newLine++, text: l });
        additions++;
      }
    } else if (part.removed) {
      if (!current) current = { header: `@@ ${relPath} @@`, lines: [] };
      for (const ctx of pendingCtx) { current.lines.push(ctx); }
      pendingCtx = [];
      for (const l of lines) {
        current!.lines.push({ type: 'del', old: oldLine++, new: -1, text: l });
        deletions++;
      }
    } else {
      for (const l of lines) {
        const ctxLine: DiffHunk['lines'][number] = { type: 'ctx', old: oldLine++, new: newLine++, text: l };
        if (current) {
          current.lines.push(ctxLine);
        } else {
          pendingCtx.push(ctxLine);
          if (pendingCtx.length > CONTEXT) pendingCtx.shift();
        }
      }
    }
  }
  flushHunk();
  // truncate giant files
  if (hunks.length > 40) hunks.length = 40;
  return { path: relPath, status, hunks, additions, deletions, oldContent: oldC, newContent: newC };
}
