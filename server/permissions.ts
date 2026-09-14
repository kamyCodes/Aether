import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import picomatch from 'picomatch';
import { nanoid } from 'nanoid';
import type { AutonomySettings, PermissionRequest, PermissionRule } from '../shared/types.js';
import { emitPermission } from './bus.js';

/** Commands that are destructive regardless of autonomy mode. */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/i,
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-[a-z]*f/i,
  /drop\s+(table|database)/i,
  /:\(\)\{.*\};:/, // fork bomb
  /mkfs|format\s+[a-z]:/i,
  /shutdown|reboot/i,
];

/** Resolve the effective autonomy decision for an operation. */
export function autonomyDecision(
  a: AutonomySettings,
  kind: PermissionRequest['kind'],
  target: string,
): 'allow' | 'deny' | 'prompt' {
  const isCommand = kind === 'command' || kind === 'install';
  // Destructive commands always prompt, even in agent-driven mode.
  if (isCommand && DESTRUCTIVE_PATTERNS.some((re) => re.test(target))) return 'prompt';
  if (a.mode === 'secure') return 'prompt';
  if (a.mode === 'agent') {
    // Only gate destructive commands (checked above); everything else flows.
    return 'allow';
  }
  if (a.mode === 'custom') {
    if (isCommand) {
      if (a.denyPrefixes.some((p) => p && target.startsWith(p))) return 'deny';
      if (a.allowPrefixes.some((p) => p && target.startsWith(p))) return 'allow';
    }
    return 'prompt';
  }
  // review (default): prompt for terminal commands; non-command kinds are
  // still gated by plan approval upstream, so allow routine file ops here.
  return isCommand ? 'prompt' : 'allow';
}

/**
 * Permission manager — every potentially dangerous agent operation flows through here.
 * Rules persist in ~/.aether/permissions.json ("always allow/deny").
 */
export class PermissionManager {
  private rulesFile = path.join(os.homedir(), '.aether', 'permissions.json');
  private rules: PermissionRule[] = [];
  private pending = new Map<string, (d: 'allow' | 'always' | 'deny') => void>();

  constructor() {
    try {
      this.rules = JSON.parse(fs.readFileSync(this.rulesFile, 'utf8')) as PermissionRule[];
    } catch {
      this.rules = [];
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.rulesFile), { recursive: true });
    fs.writeFileSync(this.rulesFile, JSON.stringify(this.rules, null, 2));
  }

  listRules(): PermissionRule[] {
    return this.rules;
  }

  addRule(rule: Omit<PermissionRule, 'id' | 'createdAt'>) {
    const r: PermissionRule = { ...rule, id: nanoid(8), createdAt: Date.now() };
    this.rules.push(r);
    this.save();
    return r;
  }

  removeRule(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.save();
  }

  /** Check saved rules; returns decision without prompting when a rule matches. */
  private matchSaved(kind: PermissionRequest['kind'], target: string): 'allow' | 'deny' | null {
    for (const r of this.rules) {
      if (r.kind !== kind) continue;
      if (r.pattern === '*' || picomatch.isMatch(target, r.pattern) || target.startsWith(r.pattern)) {
        return r.decision;
      }
    }
    return null;
  }

  /**
   * Request permission for an operation. Resolves with allow/deny.
   * If a saved "always" rule matches, resolves immediately.
   */
  autonomy: AutonomySettings = { mode: 'review', allowPrefixes: [], denyPrefixes: [] };

  async request(req: {
    kind: PermissionRequest['kind'];
    title: string;
    detail: string;
    command?: string;
    path?: string;
    taskId?: string;
  }): Promise<'allow' | 'always' | 'deny'> {
    const target = req.command ?? req.path ?? req.title;
    const saved = this.matchSaved(req.kind, target);
    if (saved === 'allow') return 'allow';
    if (saved === 'deny') return 'deny';
    // Autonomy mode short-circuit (before prompting).
    const auto = autonomyDecision(this.autonomy, req.kind, target);
    if (auto === 'allow') return 'allow';
    if (auto === 'deny') return 'deny';

    const id = nanoid(10);
    const full: PermissionRequest = { id, ts: Date.now(), ...req };
    emitPermission(full);

    const decision = await new Promise<'allow' | 'always' | 'deny'>((resolve) => {
      this.pending.set(id, resolve);
      // auto-deny after 5 minutes of silence
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve('deny');
        }
      }, 5 * 60 * 1000).unref();
    });

    if (decision === 'always') {
      this.addRule({ kind: req.kind, pattern: '*', decision: 'allow' });
    }
    return decision === 'always' ? 'allow' : decision;
  }

  decide(id: string, decision: 'allow' | 'always' | 'deny') {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(decision);
      return true;
    }
    return false;
  }

  pendingList(): PermissionRequest['id'][] {
    return [...this.pending.keys()];
  }
}
