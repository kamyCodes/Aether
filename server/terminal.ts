import { spawn } from 'node:child_process';
/**
 * TerminalManager — PTY session lifecycle (node-pty) for the integrated
 * terminal panel. One process per session, streamed over the WebSocket bus.
 * Tab metadata (title/cwd/workspace) persists to DATA_DIR/terminals.json so
 * the tab strip survives an app restart — the shells themselves are respawned
 * fresh (PTY processes cannot survive the backend), with scrollback restored
 * from the client's replay cache where available.
 */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

/** ESM-safe `require` — this project is "type": "module", so a bare
 *  require.resolve would throw ReferenceError and silently disable the PTY. */
const require = createRequire(import.meta.url);
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';

/** Structured record of one command executed in an interactive session. */
export interface TermCommand {
  command: string;
  exitCode: number | null;
  cwd: string | null;
  startedAt: number;
  finishedAt?: number;
  /** Tail of output captured between Command Executed and Command Finished. */
  outputTail?: string;
}

export interface TermSession {
  id: string;
  title: string;
  cwd: string;
  /** Workspace this terminal was opened for — terminals are scoped per
   *  workspace session so switching projects never leaks another project's
   *  shells into the tab strip. */
  workspaceId?: string;
  emitter: EventEmitter;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  history: string[];
  /** Structured command history (OSC 633 tracked), newest last. */
  commands: TermCommand[];
  /** Most recent cwd reported by the shell, for tab renaming + breadcrumbs. */
  currentCwd: string | null;
  /** Rolling raw output buffer (tail) for agent context + scrollback replay. */
  scrollback: string;
  /** Whether OSC 633 shell integration was successfully injected. */
  integrated: boolean;
}

const MAX_HISTORY = 200;
const MAX_SCROLLBACK = 120_000; // chars of raw output kept per session

/** Persisted tab entry — metadata only; shells are respawned after restart. */
interface PersistedTab {
  id: string;
  title: string;
  cwd: string;
  workspaceId?: string;
  createdAt: number;
}
const TABS_FILE = () => path.join(DATA_DIR, 'terminals.json');
const MAX_PERSISTED_TABS = 60;

export class TerminalManager {
  sessions = new Map<string, TermSession>();
  private ptyAvailable = false;
  /** dir where one-shot shell-integration init files live */
  private initDir = path.join(os.tmpdir(), 'aether-shell-integration');
  /** Tab metadata of sessions that died with the previous backend — served
   *  to clients so the tab strip survives an app restart. Cleared once the
   *  client confirms revival (or the tabs are dismissed). */
  private deadTabs: PersistedTab[] = [];
  private persistTimer: NodeJS.Timeout | null = null;

  /** Read the persisted tab metadata (boot) into the dead-tab stash. */
  private loadTabsFile() {
    try {
      const raw = JSON.parse(fs.readFileSync(TABS_FILE(), 'utf8')) as { tabs?: PersistedTab[] };
      this.deadTabs = Array.isArray(raw.tabs) ? raw.tabs.slice(-MAX_PERSISTED_TABS) : [];
    } catch {
      this.deadTabs = []; // no file yet, or corrupt
    }
  }

  /** Tabs recorded by the previous run — metadata for reviving the strip. */
  loadPersistedTabs(): PersistedTab[] {
    return [...this.deadTabs];
  }

  constructor() {
    try {
      require.resolve('node-pty');
      this.ptyAvailable = true;
    } catch {
      this.ptyAvailable = false;
    }
    try {
      fs.mkdirSync(this.initDir, { recursive: true });
    } catch {
      /* tmp */
    }
    this.loadTabsFile();
    // Final flush: the backend can be killed (Electron quit, crash) before
    // the 400ms persist debounce fires — 'exit' runs synchronously, so the
    // last tab strip state always reaches disk.
    process.on('exit', () => this.flushTabsNow());
  }

  /** Synchronous write of the current tab metadata (used at process exit). */
  private flushTabsNow() {
    const live: PersistedTab[] = [...this.sessions.values()].map((s) => ({
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      workspaceId: s.workspaceId,
      createdAt: Date.now(),
    }));
    const liveIds = new Set(live.map((t) => t.id));
    const dead = this.deadTabs.filter((t) => !liveIds.has(t.id));
    const tabs = [...dead, ...live].slice(-MAX_PERSISTED_TABS);
    try {
      fs.writeFileSync(TABS_FILE(), JSON.stringify({ tabs, savedAt: Date.now() }), 'utf8');
    } catch {
      /* best-effort — process is exiting */
    }
  }

  /** Persist live sessions' tab metadata — called on create/cwd/kill so a
   *  crash or restart restores the strip as it last looked. Not-yet-revived
   *  dead tabs are preserved in the file until the client acks their fate
   *  (otherwise the first create after a restart would erase them). */
  persistTabs() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const live: PersistedTab[] = [...this.sessions.values()]
        .slice(-MAX_PERSISTED_TABS)
        .map((s) => ({
          id: s.id,
          title: s.title,
          cwd: s.cwd,
          workspaceId: s.workspaceId,
          createdAt: Date.now(),
        }));
      const liveIds = new Set(live.map((t) => t.id));
      const dead = this.deadTabs.filter((t) => !liveIds.has(t.id));
      const tabs = [...dead, ...live].slice(-MAX_PERSISTED_TABS);
      const file = TABS_FILE();
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify({ tabs, savedAt: Date.now() }), 'utf8');
        fs.renameSync(tmp, file);
      } catch {
        /* best-effort */
      }
    }, 400);
  }

  /** Merge revived tabs back into the dead-tab stash and rewrite the file
   *  (called by the client after a successful revive flow). */
  async replaceDeadTabs(tabs: PersistedTab[]) {
    this.deadTabs = tabs.slice(-MAX_PERSISTED_TABS);
    const file = TABS_FILE();
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify({ tabs: this.deadTabs, savedAt: Date.now() }), 'utf8');
      await fsp.rename(tmp, file);
    } catch {
      /* best-effort */
    }
  }

  create(cwd: string, title?: string, workspaceId?: string): TermSession {
    const id = Math.random().toString(36).slice(2, 10);
    const emitter = new EventEmitter();
    let proc: ReturnType<typeof spawn> | import('node-pty').IPty | null = null;
    // pending typed line for history capture (closure over the session below)
    const pendingInput = { current: '' };

    const session: TermSession = {
      id,
      title: title ?? `Terminal ${this.sessions.size + 1}`,
      cwd,
      workspaceId,
      emitter,
      history: [],
      commands: [],
      currentCwd: null,
      scrollback: '',
      integrated: false,
      write(data: string) {
        // Track the user's typed line so command records carry the actual
        // command text (full 633;E reporting needs deeper shell hooks).
        for (const ch of data) {
          if (ch === '\r') {
            if (
              session.history[session.history.length - 1] !== pendingInput.current &&
              pendingInput.current.trim()
            ) {
              session.history.push(pendingInput.current);
              const last = session.commands[session.commands.length - 1];
              if (last && !last.command) last.command = pendingInput.current;
            }
            pendingInput.current = '';
          } else if (ch === '\x7f' || ch === '\b') {
            pendingInput.current = pendingInput.current.slice(0, -1);
          } else if (ch >= ' ') {
            pendingInput.current += ch;
          }
        }
        if (!proc) return;
        const ptyWrite = (session as TermSession & { ptyWrite?: (d: string) => void }).ptyWrite;
        if (ptyWrite) ptyWrite(data);
        else (proc as ReturnType<typeof spawn>).stdin?.write(data);
      },
      resize(_cols: number, _rows: number) {
        /* handled below via closure */
      },
      kill() {
        if (proc && 'kill' in proc) {
          (proc as import('node-pty').IPty).kill();
        } else if (proc) {
          (proc as ReturnType<typeof spawn>).kill();
        }
      },
    } as TermSession & { ptyWrite?: (d: string) => void };

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';

    // ── Shell integration: spawn args only, never stdin injection. ──
    // stdin multi-line injection is what produces the ">" continuation-prompt
    // leak (PowerShell echoes the incomplete parse as literal >> glyphs).
    let spawnArgs: string[] = [];
    let integrated = false;
    if (os.platform() === 'win32' && shell.toLowerCase().includes('powershell')) {
      const init = this.writePsInit();
      if (init) {
        spawnArgs = ['-NoExit', '-Command', `& '${init}'`];
        integrated = true;
      }
    } else if (os.platform() !== 'win32' && (shell.includes('bash') || shell.includes('zsh'))) {
      const init = this.writePosixInit();
      if (init) {
        spawnArgs = shell.includes('zsh') ? ['-i'] : ['--rcfile', init, '-i'];
        integrated = true;
      }
    }
    session.integrated = integrated;

    if (this.ptyAvailable) {
      import('node-pty')
        .then((pty) => {
          const p = pty.spawn(shell, spawnArgs, {
            name: 'xterm-256color',
            cols: 100,
            rows: 30,
            cwd,
            env: {
              ...process.env,
              TERM: 'xterm-256color',
              // Flag so the init script (and anything else) can detect us.
              AETHER_TERMINAL: '1',
            } as Record<string, string>,
          });
          proc = p;
          (session as TermSession & { ptyWrite?: (d: string) => void }).ptyWrite = (d: string) =>
            p.write(d);
          session.resize = (cols, rows) => {
            try {
              p.resize(cols, rows);
            } catch {
              /* dead */
            }
          };
          p.onData((d) => this.ingest(session, d));
          p.onExit(() => {
            emitter.emit('exit');
            // Shell died (user typed exit, crash): drop the tab from the
            // persisted strip too, so a restart doesn't resurrect a tab the
            // user closed inside the shell.
            this.sessions.delete(session.id);
            this.persistTabs();
          });
        })
        .catch(() => {
          this.fallbackSpawn(session, shell, cwd, spawnArgs, (p) => (proc = p));
        });
    } else {
      this.fallbackSpawn(session, shell, cwd, spawnArgs, (p) => (proc = p));
    }

    this.sessions.set(id, session);
    this.persistTabs();
    return session;
  }

  /** Write the PowerShell 633 init script; returns the file path. */
  private writePsInit(): string | null {
    try {
      const file = path.join(this.initDir, 'aether-ps.ps1');
      // Prompt function: wrap the user's original prompt. Sequence layout per
      // rendered prompt:
      //   633;A  — command line started (prompt shown)
      //   <original prompt text>
      //   633;D;<exit>;<cwd> — previous command finished
      // PostCommandLookupAction emits 633;C — command executed, output begins.
      const script = [
        `$global:__AetherOrigPrompt = $function:prompt`,
        `function global:prompt {`,
        `  $esc = [char]27; $bel = [char]7`,
        // Real process exit code when a native exe ran last; $LASTEXITCODE is
        // untouched by cmdlets, so fall back to $? for those (0/1).
        `  $e = if ($global:LASTEXITCODE -ne $null -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }`,
        `  $p = $global:__AetherOrigPrompt.Invoke()`,
        `  [Console]::Write("$esc]633;D;$e;$($PWD.Path)$bel")`,
        `  [Console]::Write("$esc]633;A$bel")`,
        `  return $p`,
        `}`,
        `$global:__AetherExecMark = {`,
        `  param($c, $a)`,
        `  $esc = [char]27; $bel = [char]7`,
        `  [Console]::Write("$esc]633;C$bel")`,
        `}`,
        `$ExecutionContext.InvokeCommand.PostCommandLookupAction = $global:__AetherExecMark`,
      ].join('\r\n');
      fs.writeFileSync(file, script, 'utf8');
      return file;
    } catch {
      return null;
    }
  }

  /** POSIX (bash/zsh) init via PROMPT_COMMAND precmd/preexec. */
  private writePosixInit(): string | null {
    try {
      const file = path.join(this.initDir, 'aether-posix.sh');
      // Built as plain concatenation — the shell's ${VAR:+...} expansion must
      // NOT be inside a JS template literal (it parses as interpolation).
      const script = [
        `__aether_precmd() {`,
        `  local e=$?; printf '\\033]633;D;%s;%s\\007' "$e" "$PWD"`,
        `  printf '\\033]633;A\\007'`,
        `}`,
        `__aether_preexec() { printf '\\033]633;C\\007'; }`,
        // Shell-side ${PROMPT_COMMAND:+;$PROMPT_COMMAND} — written verbatim via
        // concatenation so JS never parses it as interpolation.
        'PROMPT_COMMAND="__aether_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
        'preexec_functions+=(__aether_preexec)',
      ].join('\n');
      fs.writeFileSync(file, script, 'utf8');
      return file;
    } catch {
      return null;
    }
  }

  /**
   * Ingest raw pty output: track OSC 633 command lifecycle + cwd, keep a raw
   * scrollback tail, then forward the (unmodified) stream to the client. The
   * client strips stray/unterminated OSC bytes defensively so malformed
   * sequences degrade invisibly instead of leaking as text (Phase 1 fix).
   */
  private ingest(session: TermSession, data: string) {
    session.scrollback = (session.scrollback + data).slice(-MAX_SCROLLBACK);

    const oscRe = /\x1b\]633;([A-D])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
    let m: RegExpExecArray | null;
    while ((m = oscRe.exec(data))) {
      const kind = m[1];
      const payload = m[2] ?? '';
      if (kind === 'A') {
        session.commands.push({
          command: '',
          exitCode: null,
          cwd: session.currentCwd,
          startedAt: Date.now(),
        });
        if (session.commands.length > MAX_HISTORY) session.commands.shift();
        session.emitter.emit('command-started', session.commands[session.commands.length - 1]);
      } else if (kind === 'C') {
        const last = session.commands[session.commands.length - 1];
        // The user's typed command line arrives via 633;E in full VSCode
        // integration; with this minimal variant we don't have it yet —
        // capture input at the session level (see write()).
        void last;
        session.emitter.emit('command-executed');
      } else if (kind === 'D') {
        const [codeRaw, cwdRaw] = payload.split(';');
        const code = Number.parseInt(codeRaw, 10);
        const last = session.commands[session.commands.length - 1];
        if (last) {
          last.exitCode = Number.isFinite(code) ? code : null;
          last.cwd = cwdRaw || last.cwd;
          last.finishedAt = Date.now();
          last.outputTail = this.tailBetween(session.scrollback, last.startedAt);
        }
        // Tab renaming / breadcrumb feed: D carries the post-command cwd.
        if (cwdRaw && cwdRaw !== session.currentCwd) {
          session.currentCwd = cwdRaw;
          session.emitter.emit('cwd', cwdRaw);
        }
        session.emitter.emit('command-finished', last);
      }
    }
    // Cwd tracking (P=Cwd= property style, emitted with 633;P)
    const cwdRe = /\x1b\]633;P;Cwd=([^\x07\x1b]*)(?:\x07|\x1b\\)/;
    const cwdMatch = data.match(cwdRe);
    if (cwdMatch) {
      session.currentCwd = cwdMatch[1];
      session.emitter.emit('cwd', session.currentCwd);
    }

    // Forward the stream unmodified — the client strips stray OSC bytes
    // defensively so malformed sequences degrade invisibly instead of leaking
    // as text (Phase 1 fix).
    session.emitter.emit('data', data);
  }

  /** Grab the raw output written after a timestamp, trimmed to a tail. */
  private tailBetween(scrollback: string, sinceMs: number): string {
    // Approximation: we don't have per-chunk timestamps, so return the last
    // chunk of scrollback after the previous command's marker — good enough
    // for agent context (errors live at the end).
    void sinceMs;
    return scrollback.slice(-2000);
  }

  private fallbackSpawn(
    session: TermSession,
    shell: string,
    cwd: string,
    args: string[],
    set: (p: ReturnType<typeof spawn>) => void,
  ) {
    const p = spawn(shell, args, { cwd, env: process.env, stdio: 'pipe' });
    set(p);
    p.stdout?.on('data', (d) => this.ingest(session, d.toString()));
    p.stderr?.on('data', (d) => this.ingest(session, d.toString()));
    p.on('exit', () => session.emitter.emit('exit'));
    session.emitter.emit(
      'data',
      `\r\n[fallback shell — limited interactivity] ${path.basename(cwd)} $\r\n`,
    );
  }

  kill(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      s.kill();
      this.sessions.delete(id);
      this.persistTabs();
    }
  }

  /** One-shot command execution for agent tools; captures stdout/stderr/exit code. */
  exec(
    command: string,
    cwd: string,
    timeoutMs = 120_000,
    signal?: AbortSignal,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const shell =
        os.platform() === 'win32' ? ['powershell.exe', '-Command'] : ['/bin/bash', '-c'];
      const child = spawn(shell[0], [shell[1], command], { cwd, env: process.env });
      let stdout = '',
        stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      const onAbort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort);
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ code: code ?? 1, stdout: stdout.slice(-20000), stderr: stderr.slice(-20000) });
      });
    });
  }

  /** Sessions belonging to one workspace (per-workspace tab strip). */
  listForWorkspace(workspaceId: string) {
    return [...this.sessions.values()].filter((s) => s.workspaceId === workspaceId);
  }

  /** Kill every terminal opened for a workspace (called on workspace close). */
  killForWorkspace(workspaceId: string) {
    for (const s of this.listForWorkspace(workspaceId)) this.kill(s.id);
  }

  killAll() {
    for (const s of this.sessions.values()) s.kill();
    this.sessions.clear();
  }
}
