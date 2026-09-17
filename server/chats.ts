import fs from 'node:fs';
/**
 * ChatSessionStore — durable per-workspace chat threads under
 * DATA_DIR/chats/<workspaceId>.json. The client owns the canonical thread
 * content (messages stream client-side), so persistence is a mirror: the
 * client PUTs its sessions, the server stores and re-serves them on boot.
 * Writes are debounced (message bursts settle first) and atomic (tmp+rename,
 * same discipline as the workspace registry — a crash mid-write can never
 * truncate the JSON).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';

/** One workspace's persisted chat state — sessions + which thread/pane was live. */
export interface PersistedWorkspaceChats {
  workspaceId: string;
  savedAt: number;
  /** Which thread was active in this workspace's chat panel. */
  activeChatId: string | null;
  /** Task bound to the chat pane (live badge / artifacts follow). */
  chatTaskId: string | null;
  /** Task selected in the Task pane. */
  activeTaskId: string | null;
  sessions: {
    id: string;
    title: string;
    createdAt: number;
    messages: unknown[];
  }[];
}

const MAX_SESSIONS_PER_WS = 30;
const MAX_MESSAGE_CHARS = 200_000; // per message; runaway pastes can't bloat the file

export class ChatSessionStore {
  private dir = path.join(DATA_DIR, 'chats');
  private timers = new Map<string, NodeJS.Timeout>();

  constructor() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(workspaceId: string) {
    // workspaceIds are base64url of the abs path — filesystem-safe already.
    return path.join(this.dir, `${workspaceId}.json`);
  }

  /** Queue a persist for this workspace, coalescing bursts (800ms trailing). */
  save(data: PersistedWorkspaceChats) {
    const prev = this.timers.get(data.workspaceId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      data.workspaceId,
      setTimeout(() => {
        this.timers.delete(data.workspaceId);
        void this.writeNow(data);
      }, 800),
    );
  }

  private async writeNow(data: PersistedWorkspaceChats) {
    try {
      // Clamp runaway state: newest sessions win, oversized messages truncate.
      const sessions = data.sessions.slice(-MAX_SESSIONS_PER_WS).map((s) => ({
        ...s,
        messages: s.messages.map((m) => {
          const msg = m as { content?: string };
          if (typeof msg.content === 'string' && msg.content.length > MAX_MESSAGE_CHARS) {
            return { ...msg, content: msg.content.slice(0, MAX_MESSAGE_CHARS) };
          }
          return m;
        }),
      }));
      const payload: PersistedWorkspaceChats = { ...data, sessions, savedAt: Date.now() };
      const target = this.file(data.workspaceId);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(payload), 'utf8');
      await fsp.rename(tmp, target);
    } catch {
      /* best-effort persistence */
    }
  }

  async get(workspaceId: string): Promise<PersistedWorkspaceChats | null> {
    try {
      const raw = JSON.parse(
        await fsp.readFile(this.file(workspaceId), 'utf8'),
      ) as PersistedWorkspaceChats;
      if (!Array.isArray(raw.sessions)) return null;
      return raw;
    } catch {
      return null; // no file yet, or corrupt — callers start fresh
    }
  }

  /** Drop a workspace's threads (workspace closed / registry removed). */
  async delete(workspaceId: string) {
    const prev = this.timers.get(workspaceId);
    if (prev) clearTimeout(prev);
    this.timers.delete(workspaceId);
    try {
      await fsp.rm(this.file(workspaceId), { force: true });
    } catch {
      /* best-effort */
    }
  }
}
