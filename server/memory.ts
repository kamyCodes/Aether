import fs from 'node:fs';
/**
 * MemoryManager — long-term per-project memory entries the agent can read
 * and write across sessions (stored under DATA_DIR/memory).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { MemoryEntry } from '../shared/types.js';
import { DATA_DIR } from './dataDir.js';

/**
 * Agent memory — durable per-workspace facts, decisions, and conventions the
 * agent saves during runs and recalls automatically: the fragment is injected
 * into the system prompt of every task in that workspace.
 * Entries persist in ~/.aether/memory/<workspaceId>.json.
 */
export class MemoryManager {
  private dir = path.join(DATA_DIR, 'memory');
  private cache = new Map<string, MemoryEntry[]>();

  constructor() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(workspaceId: string) {
    return path.join(this.dir, `${workspaceId}.json`);
  }

  private async load(workspaceId: string): Promise<MemoryEntry[]> {
    const hit = this.cache.get(workspaceId);
    if (hit) return hit;
    try {
      const entries = JSON.parse(
        await fsp.readFile(this.file(workspaceId), 'utf8'),
      ) as MemoryEntry[];
      this.cache.set(workspaceId, entries);
      return entries;
    } catch {
      return [];
    }
  }

  private async save(workspaceId: string, entries: MemoryEntry[]) {
    this.cache.set(workspaceId, entries);
    await fsp.writeFile(this.file(workspaceId), JSON.stringify(entries, null, 2), 'utf8');
  }

  async list(workspaceId: string): Promise<MemoryEntry[]> {
    return (await this.load(workspaceId)).slice().sort((a, b) => a.ts - b.ts);
  }

  /** Add a memory; exact duplicates are ignored. Returns the entry (or existing duplicate). */
  async add(
    workspaceId: string,
    text: string,
    source: MemoryEntry['source'] = 'agent',
  ): Promise<MemoryEntry> {
    const clean = text.trim().replace(/\s+/g, ' ');
    if (!clean) throw new Error('Memory text is empty');
    const entries = await this.load(workspaceId);
    const dup = entries.find((e) => e.text.toLowerCase() === clean.toLowerCase());
    if (dup) return dup;
    const entry: MemoryEntry = {
      id: nanoid(10),
      text: clean.slice(0, 500),
      source,
      ts: Date.now(),
    };
    entries.push(entry);
    // Eviction policy: hard cap of 200 entries per workspace. On overflow the
    // OLDEST evictable entry is removed first (FIFO among agent-sourced
    // entries). User-added facts are protected from eviction as long as any
    // agent-sourced entry exists — pinned knowledge outlives session scratch.
    if (entries.length > 200) {
      const evictable = entries.findIndex((e) => e.source === 'agent');
      entries.splice(evictable === -1 ? 0 : evictable, 1);
    }
    await this.save(workspaceId, entries);
    return entry;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const entries = await this.load(workspaceId);
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) return false;
    await this.save(workspaceId, next);
    return true;
  }

  async clear(workspaceId: string): Promise<void> {
    await this.save(workspaceId, []);
  }

  /** Render the system-prompt fragment, or '' when the workspace has no memories. */
  async fragment(workspaceId: string): Promise<string> {
    const entries = await this.list(workspaceId);
    if (!entries.length) return '';
    const lines = entries.map((e) => `- ${e.text}`);
    return `Project memory (durable facts from previous sessions):\n${lines.join('\n')}`;
  }
}
