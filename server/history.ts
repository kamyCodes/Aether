import fs from 'node:fs';
/**
 * HistoryStore — durable chat/task history under DATA_DIR/history; backs the
 * session list and past-conversation views.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';
import type { AgentTask, AgentMessage, PersistedTask } from '../shared/types.js';

/**
 * Task history persistence — mirrors agent tasks, activity, and transcripts to
 * ~/.aether/history/<taskId>.json so the AgentPanel restores the last runs
 * after a restart or page refresh. Writes are fire-and-forget with a small
 * trailing window (activity bursts settle before the file is written).
 */
export class HistoryStore {
  private dir = path.join(DATA_DIR, 'history');
  private timers = new Map<string, NodeJS.Timeout>();

  constructor() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  /** Queue a persist for this task, coalescing bursts (500ms trailing debounce). */
  save(task: AgentTask, messages: AgentMessage[]) {
    const prev = this.timers.get(task.id);
    if (prev) clearTimeout(prev);
    this.timers.set(
      task.id,
      setTimeout(() => {
        this.timers.delete(task.id);
        void this.writeNow(task, messages);
      }, 500),
    );
  }

  private async writeNow(task: AgentTask, messages: AgentMessage[]) {
    try {
      const data: PersistedTask = { task, messages, savedAt: Date.now() };
      await fsp.writeFile(this.file(task.id), JSON.stringify(data), 'utf8');
    } catch {
      /* best-effort persistence */
    }
  }

  async list(workspaceId?: string, cap = 25): Promise<PersistedTask[]> {
    let ids: string[] = [];
    try {
      ids = await fsp.readdir(this.dir);
    } catch {
      return [];
    }
    const out: PersistedTask[] = [];
    for (const id of ids.filter((f) => f.endsWith('.json')).slice(-cap * 2)) {
      try {
        const data = JSON.parse(
          await fsp.readFile(path.join(this.dir, id), 'utf8'),
        ) as PersistedTask;
        if (!workspaceId || data.task.workspaceId === workspaceId) out.push(data);
      } catch {
        /* skip corrupt */
      }
      if (out.length >= cap) break;
    }
    return out.sort((a, b) => b.task.createdAt - a.task.createdAt);
  }

  async get(id: string): Promise<PersistedTask | null> {
    try {
      return JSON.parse(await fsp.readFile(this.file(id), 'utf8')) as PersistedTask;
    } catch {
      return null;
    }
  }
}
