import type { ContextReport } from '../shared/types.js';
import { countTokens } from './tokens.js';
import type { ProjectIndexer } from './indexer.js';

export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Compaction threshold: summarize older history once this % of the window is used. */
export const COMPACT_AT_PCT = 80;

/**
 * Context manager — tracks what the AI currently "knows" (system prompt,
 * included files, chat history, tool results) and enforces a token budget.
 * Token counts are estimates (~4 chars/token) unless the provider reports usage.
 */
export class ContextManager {
  contextWindow = DEFAULT_CONTEXT_WINDOW;
  private pinned = new Set<string>();
  private ignored = new Set<string>();
  private included = new Map<string, string>(); // path -> content snapshot included in prompt
  systemTokens = 0;
  skillsTokens = 0;
  chatTokens = 0;
  toolsTokens = 0;
  lastExact: { input: number; output: number } | null = null;
  /** Cumulative provider-reported usage for the whole thread (all calls). */
  threadUsage = { input: 0, cachedInput: 0, output: 0, calls: 0 };

  setWindow(n: number) {
    if (n > 1000) this.contextWindow = n;
  }

  pin(path: string) {
    this.pinned.add(path);
  }
  unpin(path: string) {
    this.pinned.delete(path);
  }
  pinnedList() {
    return [...this.pinned];
  }
  ignore(path: string) {
    this.ignored.add(path);
    this.included.delete(path);
  }
  unignore(path: string) {
    this.ignored.delete(path);
  }
  ignoredList() {
    return [...this.ignored];
  }

  includeFile(rel: string, content: string) {
    if (this.ignored.has(rel)) return;
    this.included.set(rel, content);
  }

  excludeFile(rel: string) {
    this.included.delete(rel);
  }

  includedFiles() {
    return [...this.included.keys()];
  }

  /** Build file content blocks for the prompt, respecting budget (pinned first). */
  buildFileBlocks(budgetTokens: number): { text: string; usedTokens: number } {
    const order = [
      ...[...this.included.keys()].filter((p) => this.pinned.has(p)),
      ...[...this.included.keys()].filter((p) => !this.pinned.has(p)),
    ];
    const blocks: string[] = [];
    let used = 0;
    for (const p of order) {
      const content = this.included.get(p)!;
      const t = countTokens(content) + p.length;
      if (used + t > budgetTokens) {
        blocks.push(`(${p} omitted — context budget reached)`);
        continue;
      }
      blocks.push(`--- FILE: ${p} ---\n${content}`);
      used += t;
    }
    return { text: blocks.join('\n\n'), usedTokens: used };
  }

  /** Compress chat history: keep the last N messages verbatim, summarize earlier ones. */
  compressChat<T extends { content: string; role: string }>(history: T[], keepLast = 12, maxTokens = 6000): T[] {
    let total = history.reduce((a, m) => a + countTokens(m.content), 0);
    if (total <= maxTokens) return history;
    const out = [...history];
    while (out.length > keepLast && total > maxTokens) {
      const dropped = out.shift()!;
      total -= countTokens(dropped.content);
    }
    return out;
  }

  /** Record one provider usage report into the cumulative thread totals. */
  recordThreadUsage(input: number, output: number, cachedInput = 0) {
    this.threadUsage.input += input;
    this.threadUsage.cachedInput += cachedInput;
    this.threadUsage.output += output;
    this.threadUsage.calls += 1;
  }

  report(indexer?: ProjectIndexer): ContextReport {
    const files = [...this.included.entries()].map(([p, content]) => ({
      path: p,
      tokens: countTokens(content),
      pinned: this.pinned.has(p),
    }));
    const used =
      this.systemTokens + this.skillsTokens + this.chatTokens + this.toolsTokens +
      files.reduce((a, f) => a + f.tokens, 0);
    return {
      contextWindow: this.contextWindow,
      used,
      exact: this.lastExact !== null,
      breakdown: {
        system: this.systemTokens,
        files: files.reduce((a, f) => a + f.tokens, 0),
        chat: this.chatTokens,
        tools: this.toolsTokens,
        skills: this.skillsTokens,
      },
      files,
      compactAtPct: COMPACT_AT_PCT,
      threadUsage: { ...this.threadUsage },
    };
  }

  reset() {
    this.included.clear();
    this.chatTokens = 0;
    this.toolsTokens = 0;
    this.lastExact = null;
  }
}
