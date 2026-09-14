import fs from 'node:fs';
/**
 * CheckpointManager — persisted snapshots of task state so an agent run can
 * be resumed (or rolled back) after a crash or restart.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Checkpoint } from '../shared/types.js';

/**
 * Checkpoint manager — snapshots file contents before major agent operations.
 * Stored under ~/.aether/checkpoints/<workspaceId>/.
 */
export class CheckpointManager {
  private base: string;

  constructor(baseDir: string) {
    this.base = path.join(baseDir, 'checkpoints');
    fs.mkdirSync(this.base, { recursive: true });
  }

  private dirFor(wsId: string) {
    const d = path.join(this.base, wsId);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  async create(
    workspaceId: string,
    files: { path: string; content: string | null }[],
    label: string,
    auto: boolean,
  ): Promise<Checkpoint> {
    const cp: Checkpoint = {
      id: nanoid(10),
      workspaceId,
      label,
      createdAt: Date.now(),
      auto,
      files: files.map((f) => ({
        path: f.path,
        content: f.content,
        hash: Buffer.from(f.content ?? '')
          .toString('base64')
          .slice(0, 16),
      })),
    };
    await fsp.writeFile(path.join(this.dirFor(workspaceId), `${cp.id}.json`), JSON.stringify(cp));
    return cp;
  }

  async list(workspaceId: string): Promise<Checkpoint[]> {
    try {
      const files = await fsp.readdir(this.dirFor(workspaceId));
      const cps = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(
            async (f) =>
              JSON.parse(
                await fsp.readFile(path.join(this.dirFor(workspaceId), f), 'utf8'),
              ) as Checkpoint,
          ),
      );
      return cps.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  async get(workspaceId: string, id: string): Promise<Checkpoint | null> {
    try {
      return JSON.parse(
        await fsp.readFile(path.join(this.dirFor(workspaceId), `${id}.json`), 'utf8'),
      ) as Checkpoint;
    } catch {
      return null;
    }
  }

  /** Restore: write back all snapshotted files; delete files created after checkpoint. */
  async restore(
    workspaceId: string,
    id: string,
    io: {
      currentFiles: () => Promise<string[]>;
      readFile: (rel: string) => Promise<string>;
      writeFile: (rel: string, content: string) => Promise<void>;
      deleteFile: (rel: string) => Promise<void>;
    },
  ): Promise<{ restored: string[]; deleted: string[] }> {
    const cp = await this.get(workspaceId, id);
    if (!cp) throw new Error('Checkpoint not found');
    const current = new Set(await io.currentFiles());
    const snapshotted = new Set(cp.files.map((f) => f.path));
    const restored: string[] = [];
    const deleted: string[] = [];

    for (const f of cp.files) {
      if (f.content !== null) {
        await io.writeFile(f.path, f.content);
        restored.push(f.path);
      }
    }
    for (const p of current) {
      if (!snapshotted.has(p)) {
        await io.deleteFile(p);
        deleted.push(p);
      }
    }
    return { restored, deleted };
  }
}
