import path from 'node:path';
/**
 * ToolRegistry — the agent's tool surface: file edit, shell, search, git.
 * Each tool execution flows through PermissionManager before touching disk.
 */
import { nanoid } from 'nanoid';
import type { ChangeProposal, FileDiff } from '../shared/types.js';
import type { WorkspaceManager } from './workspace.js';
import type { PermissionManager } from './permissions.js';
import type { GitManager } from './git.js';
import type { TerminalManager } from './terminal.js';
import type { CheckpointManager } from './checkpoints.js';
import type { ProjectIndexer } from './indexer.js';
import { buildFileDiff } from './git.js';
import { bus, emitActivity } from './bus.js';
import type { ActivityItem } from '../shared/types.js';
import type { MemoryManager } from './memory.js';

export interface ToolContext {
  workspaceId: string;
  taskId: string;
  cwd: string;
  autoApprove: boolean; // session-level "yolo" setting
  signal?: AbortSignal;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  permission?: {
    kind:
      'read' | 'write' | 'delete' | 'command' | 'install' | 'network' | 'git' | 'env' | 'deploy';
    derive: (args: Record<string, unknown>) => {
      title: string;
      detail: string;
      command?: string;
      path?: string;
    };
  };
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export class ToolRegistry {
  tools = new Map<string, ToolDef>();
  /** Open proposals awaiting user accept/reject, keyed by proposal id. */
  proposals = new Map<string, ChangeProposal>();

  constructor(
    private ws: WorkspaceManager,
    private perms: PermissionManager,
    private gitm: GitManager,
    private terms: TerminalManager,
    private cps: CheckpointManager,
    private indexer: ProjectIndexer,
    private memory: MemoryManager,
  ) {
    this.registerDefaults();
  }

  jsonSchema() {
    return [...this.tools.values()].map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters,
          required: Object.keys(t.parameters).filter((k) => t.parameters[k].type !== 'optional'),
        },
      },
    }));
  }

  names() {
    return [...this.tools.keys()];
  }

  private async act(
    tool: ToolDef,
    args: Record<string, unknown>,
    ctx: ToolContext,
    label: string,
  ): Promise<string> {
    // permission gate
    if (tool.permission && !ctx.autoApprove) {
      const d = tool.permission.derive(args);
      const decision = await this.perms.request({
        kind: tool.permission.kind,
        taskId: ctx.taskId,
        ...d,
      });
      if (decision === 'deny') return `DENIED: user denied permission for ${label}`;
    }
    const item: ActivityItem = {
      id: nanoid(10),
      taskId: ctx.taskId,
      status: 'running',
      icon: '⟳',
      label,
      tool: tool.name,
      filePath: (args.path as string) ?? undefined,
      command: (args.command as string) ?? undefined,
      ts: Date.now(),
    };
    emitActivity(item);
    const started = Date.now();
    try {
      const result = await tool.execute(args, ctx);
      emitActivity({
        ...item,
        status: 'done',
        icon: '✓',
        result: result.slice(0, 400),
        detail: `${Date.now() - started}ms`,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitActivity({ ...item, status: 'error', icon: '✗', error: msg });
      return `ERROR: ${msg}`;
    }
  }

  private register(t: ToolDef) {
    this.tools.set(t.name, t);
  }

  /** Execute a tool by name with activity + permission handling. */
  run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return Promise.resolve(`ERROR: unknown tool ${name}`);
    const label = humanLabel(tool.name, args);
    return this.act(tool, args, ctx, label);
  }

  private registerDefaults() {
    const root = () => this.ws.require(ctxWs()).root;
    let currentCtx: ToolContext | null = null;
    const ctxWs = () => currentCtx?.workspaceId ?? '';

    // Wrapper so execute() can access the current context
    const withCtx =
      (fn: (args: Record<string, unknown>, wsId: string) => Promise<string>): ToolDef['execute'] =>
      (args, ctx) => {
        currentCtx = ctx;
        return fn(args, ctx.workspaceId);
      };

    this.register({
      name: 'read_file',
      description: 'Read a text file from the workspace.',
      parameters: { path: { type: 'string', description: 'workspace-relative path' } },
      permission: {
        kind: 'read',
        derive: (a) => ({
          title: `Read file ${a.path}`,
          detail: 'The agent wants to read a file.',
          path: String(a.path),
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const content = await this.ws.readFile(wsId, String(a.path));
        return content.length > 24000 ? content.slice(0, 24000) + '\n…(truncated)' : content;
      }),
    });

    this.register({
      name: 'write_file',
      description:
        'Create or overwrite a file with full content. Produces a diff proposal the user can accept or reject.',
      parameters: {
        path: { type: 'string', description: 'workspace-relative path' },
        content: { type: 'string', description: 'full file content' },
      },
      permission: {
        kind: 'write',
        derive: (a) => ({
          title: `Write file ${a.path}`,
          detail: 'The agent wants to create or overwrite a file.',
          path: String(a.path),
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const p = String(a.path);
        const content = String(a.content ?? '');
        let old = '';
        try {
          old = await this.ws.readFile(wsId, p);
        } catch {
          /* new file */
        }
        const diff = buildFileDiff(p, old === '' ? 'added' : 'modified', old, content);
        await this.ws.writeFile(wsId, p, content);
        const proposal = makeProposal(ctxTask(), [{ diff }]);
        this.proposals.set(proposal.id, proposal);
        bus.emit('proposal', proposal);
        this.indexer.onFileChanged(p);
        return `Wrote ${p} (${content.split('\n').length} lines). Proposal ${proposal.id} created for review.`;
      }),
    });

    this.register({
      name: 'edit_file',
      description: 'Replace an exact substring in a file. Use read_file first to get exact text.',
      parameters: {
        path: { type: 'string', description: 'workspace-relative path' },
        old_string: { type: 'string', description: 'exact text to replace' },
        new_string: { type: 'string', description: 'replacement text' },
      },
      permission: {
        kind: 'write',
        derive: (a) => ({
          title: `Edit file ${a.path}`,
          detail: `Replace "${String(a.old_string).slice(0, 80)}" with new content.`,
          path: String(a.path),
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const p = String(a.path);
        const oldS = String(a.old_string ?? '');
        const newS = String(a.new_string ?? '');
        const content = await this.ws.readFile(wsId, p);
        if (!content.includes(oldS))
          return `ERROR: old_string not found in ${p}. Read the file again for exact text.`;
        const updated = content.replace(oldS, newS);
        const diff = buildFileDiff(p, 'modified', content, updated);
        await this.ws.writeFile(wsId, p, updated);
        const proposal = makeProposal(ctxTask(), [{ diff }]);
        this.proposals.set(proposal.id, proposal);
        bus.emit('proposal', proposal);
        this.indexer.onFileChanged(p);
        return `Edited ${p}. Proposal ${proposal.id} created for review.`;
      }),
    });

    this.register({
      name: 'delete_file',
      description: 'Delete a file or directory from the workspace.',
      parameters: { path: { type: 'string', description: 'workspace-relative path' } },
      permission: {
        kind: 'delete',
        derive: (a) => ({
          title: `Delete ${a.path}`,
          detail: 'This operation cannot be undone except via checkpoints/git.',
          path: String(a.path),
        }),
      },
      execute: withCtx(async (a, wsId) => {
        await this.ws.deleteFile(wsId, String(a.path));
        return `Deleted ${a.path}`;
      }),
    });

    this.register({
      name: 'list_files',
      description: 'List workspace files (flat relative paths, respects ignore rules).',
      parameters: {},
      execute: withCtx(async (_a, wsId) => {
        const files = await this.ws.listFiles(wsId);
        return files.slice(0, 400).join('\n');
      }),
    });

    this.register({
      name: 'search_files',
      description: 'Full-text search across the indexed project.',
      parameters: { query: { type: 'string', description: 'search query' } },
      execute: withCtx(async (a) => {
        const results = this.indexer.fuzzySearch(String(a.query ?? ''), 30);
        if (!results.length) return 'No matches. Index may still be building.';
        return results.map((r) => `${r.path} (score ${r.score.toFixed(1)})`).join('\n');
      }),
    });

    this.register({
      name: 'search_symbols',
      description: 'Search code symbols (functions, classes, types) by name.',
      parameters: { query: { type: 'string', description: 'symbol name or fragment' } },
      execute: withCtx(async (a) => {
        const syms = this.indexer.searchSymbols(String(a.query ?? ''), 40);
        return syms.length
          ? syms.map((s) => `${s.kind} ${s.name} @ ${s.path}:${s.line}`).join('\n')
          : 'No symbols found.';
      }),
    });

    this.register({
      name: 'run_command',
      description:
        'Run a shell command in the workspace. Dangerous commands require user permission.',
      parameters: { command: { type: 'string', description: 'shell command' } },
      permission: {
        kind: 'command',
        derive: (a) => ({
          title: 'Run terminal command',
          detail: 'The agent wants to execute a shell command.',
          command: String(a.command),
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const cmd = String(a.command ?? '');
        const cwd = this.ws.require(wsId).root;
        const r = await this.terms.exec(cmd, cwd, 180_000, ctxSignal());
        const out = [`exit=${r.code}`, r.stdout, r.stderr].filter(Boolean).join('\n');
        return out.slice(0, 8000) || '(no output)';
      }),
    });

    this.register({
      name: 'install_dependency',
      description: 'Install a package with npm/pnpm/yarn (auto-detects lockfile).',
      parameters: {
        name: { type: 'string', description: 'package name' },
        dev: { type: 'string', description: '"true" for devDependency' },
      },
      permission: {
        kind: 'install',
        derive: (a) => ({
          title: `Install dependency ${a.name}`,
          detail: 'Package installation can run arbitrary postinstall scripts.',
          command: `install ${a.name}`,
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const cwd = this.ws.require(wsId).root;
        const name = String(a.name ?? '');
        const flag = a.dev === 'true' || a.dev === true ? ' -D' : '';
        const cmd = `npm install${flag} ${name}`;
        const r = await this.terms.exec(cmd, cwd, 300_000, ctxSignal());
        return `exit=${r.code}\n${(r.stdout + r.stderr).slice(0, 4000)}`;
      }),
    });

    this.register({
      name: 'run_tests',
      description: 'Run the project test suite (auto-detects npm test / pytest / go test).',
      parameters: {},
      execute: withCtx(async (_a, wsId) => {
        const cwd = this.ws.require(wsId).root;
        const fs = await import('node:fs');
        const has = (f: string) => fs.existsSync(path.join(cwd, f));
        const cmd =
          has('pytest.ini') || has('pyproject.toml')
            ? 'pytest -q'
            : has('go.mod')
              ? 'go test ./...'
              : has('Cargo.toml')
                ? 'cargo test -q'
                : 'npm test -- --run 2>&1 || npm test';
        const r = await this.terms.exec(cmd, cwd, 300_000, ctxSignal());
        return `exit=${r.code}\n${(r.stdout + r.stderr).slice(0, 8000)}`;
      }),
    });

    this.register({
      name: 'run_build',
      description: 'Run the project build script (npm run build / make / cargo build).',
      parameters: {},
      execute: withCtx(async (_a, wsId) => {
        const cwd = this.ws.require(wsId).root;
        const r = await this.terms.exec(
          'npm run build 2>&1 || make 2>&1',
          cwd,
          300_000,
          ctxSignal(),
        );
        return `exit=${r.code}\n${(r.stdout + r.stderr).slice(0, 8000)}`;
      }),
    });

    this.register({
      name: 'inspect_errors',
      description: 'Inspect recent build/test/runtime errors captured from the workspace.',
      parameters: {},
      execute: withCtx(async () => {
        const errors = this.errorLog.slice(-20);
        return errors.length ? errors.join('\n---\n') : 'No captured errors.';
      }),
    });

    // --- Git tools ---
    const gperm = (a: Record<string, unknown>, title: string) => ({
      kind: 'git' as const,
      derive: () => ({
        title,
        detail: 'Git operation requested by the agent.',
        command: String(a.command ?? title),
      }),
    });

    this.register({
      name: 'git_status',
      description: 'Show git status of the workspace.',
      parameters: {},
      execute: withCtx(async (_a, wsId) => {
        const s = await this.gitm.status(this.ws.require(wsId).root);
        return `Branch: ${s.current}\n` + s.files.map((f) => `${f.status} ${f.path}`).join('\n');
      }),
    });

    this.register({
      name: 'git_diff',
      description: 'Show working-tree diff for a file (or all files).',
      parameters: { path: { type: 'optional', description: 'file path (optional)' } },
      execute: withCtx(async (a, wsId) => {
        const wsRoot = this.ws.require(wsId).root;
        const s = await this.gitm.status(wsRoot);
        const files = a.path ? [String(a.path)] : s.files.map((f) => f.path).slice(0, 10);
        const diffs = await Promise.all(files.map((f) => this.gitm.diff(wsRoot, f)));
        return (
          diffs.map((d) => `${d.path}: +${d.additions} -${d.deletions}`).join('\n') || 'No changes.'
        );
      }),
    });

    this.register({
      name: 'git_commit',
      description: 'Stage changed files and create a git commit.',
      parameters: { message: { type: 'string', description: 'commit message' } },
      permission: {
        kind: 'git',
        derive: (a) => ({
          title: 'Create git commit',
          detail: `Message: ${a.message}`,
          command: `git commit -m "${a.message}"`,
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const wsRoot = this.ws.require(wsId).root;
        const s = await this.gitm.status(wsRoot);
        await this.gitm.addAll(
          wsRoot,
          s.files.map((f) => f.path),
        );
        const sha = await this.gitm.commit(wsRoot, String(a.message ?? 'Agent commit'));
        // Broadcast for DB capture (git_commits) and UI surfacing.
        bus.emit('agent:commit', { workspaceId: wsId, commitHash: sha, taskId: ctxTask() });
        return `Committed ${sha.slice(0, 8)}: ${a.message}`;
      }),
    });

    this.register({
      name: 'git_branch',
      description: 'Create a git branch (and check it out).',
      parameters: { name: { type: 'string', description: 'branch name' } },
      permission: {
        kind: 'git',
        derive: (a) => ({
          title: `Create branch ${a.name}`,
          detail: 'Creates and checks out a new branch.',
          command: `git checkout -b ${a.name}`,
        }),
      },
      execute: withCtx(async (a, wsId) => {
        await this.gitm.branch(this.ws.require(wsId).root, String(a.name));
        return `Branch ${a.name} created and checked out.`;
      }),
    });

    // --- Memory ---
    this.register({
      name: 'save_memory',
      description:
        'Save a durable fact, decision, or convention about this project to long-term memory. Use for things future sessions must know: user preferences, architecture decisions, gotchas, workflow rules. Not for task-specific details.',
      parameters: { text: { type: 'string', description: 'the fact to remember, one sentence' } },
      execute: withCtx(async (a, wsId) => {
        const entry = await this.memory.add(wsId, String(a.text ?? ''), 'agent');
        return `Saved to project memory: "${entry.text}"`;
      }),
    });

    // --- Checkpoints ---
    this.register({
      name: 'create_checkpoint',
      description: 'Snapshot current workspace files so the task can be rolled back.',
      parameters: { label: { type: 'string', description: 'checkpoint label' } },
      execute: withCtx(async (a, wsId) => {
        const cp = await this.createCheckpointFor(wsId, ctxTask(), String(a.label ?? 'checkpoint'));
        return `Checkpoint ${cp.id} created (${cp.files.length} files).`;
      }),
    });

    this.register({
      name: 'restore_checkpoint',
      description: 'Restore the workspace to a previous checkpoint.',
      parameters: { id: { type: 'string', description: 'checkpoint id' } },
      permission: {
        kind: 'write',
        derive: (a) => ({
          title: `Restore checkpoint ${a.id}`,
          detail: 'Files will be reverted to the checkpoint state.',
          command: `restore ${a.id}`,
        }),
      },
      execute: withCtx(async (a, wsId) => {
        const res = await this.cps.restore(wsId, String(a.id), {
          currentFiles: () => this.ws.listFiles(wsId),
          readFile: (p) => this.ws.readFile(wsId, p),
          writeFile: (p, c) => this.ws.writeFile(wsId, p, c),
          deleteFile: (p) => this.ws.deleteFile(wsId, p),
        });
        return `Restored ${res.restored.length} files, deleted ${res.deleted.length}.`;
      }),
    });

    // context helpers
    function ctxTask() {
      return currentCtx?.taskId ?? 'adhoc';
    }
    function ctxSignal() {
      return currentCtx?.signal;
    }
  }

  errorLog: string[] = [];

  pushError(line: string) {
    this.errorLog.push(line);
    if (this.errorLog.length > 100) this.errorLog.shift();
  }

  async createCheckpointFor(wsId: string, taskId: string, label: string) {
    const files = await this.ws.listFiles(wsId);
    const snapshot: { path: string; content: string | null }[] = [];
    for (const p of files.slice(0, 300)) {
      try {
        const stat = await (
          await import('node:fs/promises')
        ).stat(path.join(this.ws.require(wsId).root, p));
        if (stat.size > 200_000) {
          snapshot.push({ path: p, content: null });
          continue;
        }
        snapshot.push({ path: p, content: await this.ws.readFile(wsId, p) });
      } catch {
        snapshot.push({ path: p, content: null });
      }
    }
    return this.cps.create(wsId, snapshot, label, true);
  }

  acceptProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p) return false;
    p.status = 'accepted';
    this.proposals.delete(id);
    return true;
  }

  rejectProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p) return false;
    p.status = 'rejected';
    this.proposals.delete(id);
    return true;
  }
}

function makeProposal(taskId: string, diffs: { diff: FileDiff }[]): ChangeProposal {
  return {
    id: nanoid(10),
    taskId,
    title: 'Agent changes',
    files: diffs.map((d) => d.diff),
    createdAt: Date.now(),
    status: 'pending',
  };
}

function humanLabel(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
      return `Read ${args.path}`;
    case 'write_file':
      return `Write ${args.path}`;
    case 'edit_file':
      return `Edit ${args.path}`;
    case 'delete_file':
      return `Delete ${args.path}`;
    case 'list_files':
      return 'Listed project files';
    case 'search_files':
      return `Searched "${args.query}"`;
    case 'search_symbols':
      return `Searched symbols "${args.query}"`;
    case 'run_command':
      return `Running \`${args.command}\``;
    case 'install_dependency':
      return `Installing ${args.name}`;
    case 'run_tests':
      return 'Running tests…';
    case 'run_build':
      return 'Running build…';
    case 'inspect_errors':
      return 'Inspecting errors';
    case 'git_status':
      return 'Git status';
    case 'git_diff':
      return 'Git diff';
    case 'git_commit':
      return `Commit: ${args.message}`;
    case 'git_branch':
      return `Branch: ${args.name}`;
    case 'create_checkpoint':
      return `Checkpoint: ${args.label}`;
    case 'restore_checkpoint':
      return `Restoring checkpoint ${args.id}`;
    default:
      return tool;
  }
}
