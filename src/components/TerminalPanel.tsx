import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, X, Search, Sparkles, CircleCheck, CircleX, Play } from 'lucide-react';
import { useStore, wsSend, getWs } from '../lib/store';
import { get } from '../lib/api';
import { GlassButton } from './glass';

interface TermInstance {
  id: string;
  title: string;
  cwd?: string;
  integrated?: boolean;
}

/** Structured command record mirrored from the server's OSC 633 tracking. */
interface TermCommand {
  command: string;
  exitCode: number | null;
  cwd: string | null;
  startedAt: number;
  finishedAt?: number;
  outputTail?: string;
}

/** One dynamic, project-aware suggestion chip ("npm run dev", "cargo run"…). */
interface TermSuggestion {
  command: string;
  label: string;
}

/** Colors for xterm, resolved from the active CSS theme at attach-time. */
function xtermThemeFromCss(): Record<string, string> {
  try {
    const s = getComputedStyle(document.documentElement);
    const c = (v: string) => s.getPropertyValue(v).trim() || undefined;
    const accent = c('--accent') ?? '#6E62E5';
    return {
      background: 'rgba(0,0,0,0)',
      foreground: c('--text') ?? '#e8eaf2',
      cursor: accent,
      cursorAccent: c('--bg') ?? '#0b0d14',
      selectionBackground: accent,
      selectionForeground: c('--bg') ?? '#0b0d14',
      black: c('--border-strong') ?? '#34343c',
      red: c('--err') ?? '#e5736b',
      green: c('--ok') ?? '#7cc08f',
      yellow: c('--warn') ?? '#e0b84e',
      blue: '#6c8cff',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      brightBlack: c('--text-faint') ?? '#7e8596',
      brightRed: '#f08c84',
      brightGreen: '#9adfae',
      brightYellow: '#ecd08a',
      brightBlue: '#93aeff',
      brightMagenta: '#d5b3ff',
      brightCyan: '#7ce4f5',
      brightWhite: '#ffffff',
      white: c('--text') ?? '#e8eaf2',
    };
  } catch {
    return {};
  }
}

const buffers = new Map<string, string[]>();
function bufferFor(id: string): string[] {
  let b = buffers.get(id);
  if (!b) {
    b = [];
    buffers.set(id, b);
  }
  return b;
}

/**
 * Phase 1 fallback strip: remove any OSC sequence the renderer won't consume
 * (633 lifecycle markers included) so malformed or unterminated sequences
 * degrade invisibly instead of leaking as literal text (the ">" artifact).
 * Runs on every chunk BEFORE term.write() and on replayed buffer history.
 */
function sanitizeTermChunk(data: string): string {
  // Complete OSC sequences (BEL or ST terminated) — strip 633 + other private
  // marks xterm has no handler for. Standard sequences (0;title, 7;cwd, 1337)
  // are handled by xterm itself when the parser gets them; we only remove
  // known integration markers and anything unterminated at chunk end.
  let out = data.replace(/\x1b\]633;[^\x07\x1b]*(?:\x07|\x1b\\)?/g, '');
  // Unterminated OSC at the end of a chunk: hold the tail back until the next
  // chunk arrives, so a split sequence never flashes as garbage text.
  const lastEsc = out.lastIndexOf('\x1b]');
  if (
    lastEsc !== -1 &&
    out.indexOf('\x07', lastEsc) === -1 &&
    out.indexOf('\x1b\\', lastEsc) === -1
  ) {
    pendingOsc = out.slice(lastEsc);
    out = out.slice(0, lastEsc);
  } else if (pendingOsc) {
    out = pendingOsc + out;
    pendingOsc = '';
  }
  return out;
}
let pendingOsc = '';

/** Per-session client mirror of command records (for decorations + Ask Agent). */
const commandLog = new Map<string, TermCommand[]>();

export function TerminalPanel() {
  const [terms, setTerms] = useState<TermInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // bump to re-resolve CSS vars after theme switch
  const [searchOpen, setSearchOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TermSuggestion[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mountLock = useRef(false);
  const xtermRefs = useRef<
    Map<
      string,
      {
        term: import('@xterm/xterm').Terminal;
        fit: () => void;
        ro?: ResizeObserver;
        mo?: MutationObserver;
        search?: import('@xterm/addon-search').SearchAddon;
        lastExit: number | null;
        lastCmd: string;
        lastCwd: string | null;
      }
    >
  >(new Map());
  const theme = useStore((s) => s.settings?.ui.theme ?? 'dark');
  const workspaceId = useStore((s) => s.workspaceId);
  const cwd = useStore((s) => s.workspaces.find((w) => w.id === s.workspaceId)?.root);

  // Dynamic, project-aware suggestions (package.json scripts, git status, …).
  // Re-probed whenever the workspace changes — they're keyed to the project.
  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setSuggestions([]);
      return;
    }
    get<{ suggestions: TermSuggestion[] }>(`/workspaces/${workspaceId}/terminal-suggestions`)
      .then((r) => {
        if (!cancelled) setSuggestions(r.suggestions ?? []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Attach to the shared WebSocket for terminal traffic.
  useEffect(() => {
    let cancelled = false;
    const attach = (socket: WebSocket) => {
      if (cancelled) return;
      const onMessage = (ev: MessageEvent) => {
        try {
          const { type, payload } = JSON.parse(ev.data);
          if (type === 'term:created') {
            const t = payload as TermInstance;
            setTerms((prev) => (prev.some((p) => p.id === t.id) ? prev : [...prev, t]));
            setActiveId((cur) => cur ?? t.id);
          } else if (type === 'term:data') {
            const { id, data } = payload as { id: string; data: string };
            const clean = sanitizeTermChunk(data);
            const entry = xtermRefs.current.get(id);
            if (entry) entry.term.write(clean);
            else bufferFor(id).push(clean);
          } else if (type === 'term:cwd') {
            const {
              id,
              title,
              cwd: newCwd,
            } = payload as { id: string; title: string; cwd: string };
            setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, title, cwd: newCwd } : t)));
            const entry = xtermRefs.current.get(id);
            if (entry) entry.lastCwd = newCwd;
          } else if (type === 'term:command') {
            const { id, command } = payload as { id: string; command: TermCommand };
            const log = commandLog.get(id) ?? [];
            log.push(command);
            commandLog.set(id, log.slice(-100));
            const entry = xtermRefs.current.get(id);
            if (entry) {
              entry.lastExit = command.exitCode;
              entry.lastCmd = command.command;
              entry.lastCwd = command.cwd ?? entry.lastCwd;
            }
            // AI suggestion chip (Phase 4.3): only after a failure, only the
            // command text — never auto-executed.
            if (command.exitCode !== null && command.exitCode !== 0 && command.command) {
              setSuggestion(command.command);
            } else if (command.exitCode === 0) {
              setSuggestion(null);
            }
          }
        } catch {
          /* not for us */
        }
      };
      socket.addEventListener('message', onMessage);
    };
    const existing = getWs();
    if (existing && existing.readyState === WebSocket.OPEN) attach(existing);
    else {
      const t = setInterval(() => {
        const ws = getWs();
        if (ws && ws.readyState === WebSocket.OPEN) {
          attach(ws);
          clearInterval(t);
        }
      }, 300);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-spawn one terminal when the panel first has a workspace.
  useEffect(() => {
    if (cwd && terms.length === 0 && !mountLock.current) {
      mountLock.current = true;
      wsSend('term:create', { cwd });
    }
    if (!cwd) mountLock.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, terms.length]);

  // Mount/unmount xterm instances as the active tab changes.
  useEffect(() => {
    let disposed = false;
    const map = xtermRefs.current;
    if (!activeId || !containerRef.current || map.has(activeId)) return;

    (async () => {
      const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-search'),
      ]);
      if (disposed || !containerRef.current || !activeId || map.has(activeId)) return;
      const term = new Terminal({
        fontSize: 12.5,
        // Aether mono stack: ligature-capable fonts first where available.
        fontFamily:
          "'JetBrains Mono', 'Cascadia Code', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        theme: xtermThemeFromCss(),
        cursorBlink: true,
        cursorStyle: 'bar',
        cursorWidth: 2,
        smoothScrollDuration: 120,
        scrollback: 5000,
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      const search = new SearchAddon();
      term.loadAddon(search);
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(term.element ?? document.createElement('div'));
      term.open(containerRef.current.lastElementChild as HTMLElement);
      try {
        fit.fit();
      } catch {
        /* zero-size */
      }

      const fitFn = () => {
        try {
          fit.fit();
        } catch {
          /* hidden */
        }
      };
      term.onData((d) => wsSend('term:input', { id: activeId, data: d }));
      term.onResize(({ cols, rows }) => wsSend('term:resize', { id: activeId, cols, rows }));
      wsSend('term:resize', { id: activeId, cols: term.cols, rows: term.rows });
      term.focus();

      // Phase 2.5: clickable paths + URLs → file-open API / browser.
      try {
        term.registerLinkProvider({
          provideLinks: (lineNumber, cb) => {
            const line = term.buffer.active.getLine(lineNumber)?.translateToString(true) ?? '';
            const links: import('@xterm/xterm').ILink[] = [];
            const urlRe = /https?:\/\/[^\s)\]]+/g;
            const pathRe = /(?:[A-Za-z]:)?[\w./\\-]+\/[\w./\\-]+\.\w{1,6}\b/g;
            for (const re of [urlRe, pathRe]) {
              let m: RegExpExecArray | null;
              while ((m = re.exec(line))) {
                const text = m[0];
                links.push({
                  text,
                  range: {
                    start: { x: m.index + 1, y: lineNumber },
                    end: { x: m.index + text.length, y: lineNumber },
                  },
                  activate: () => {
                    if (/^https?:\/\//.test(text)) window.open(text, '_blank');
                    else void useStore.getState().openFile(text.replace(/^\.?\//, ''));
                  },
                });
              }
            }
            cb(links.length ? links : undefined);
          },
        });
      } catch {
        /* link provider optional */
      }

      // Phase 5: copy-on-select + right-click paste.
      term.onSelectionChange(() => {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard?.writeText(sel).catch(() => {});
      });
      term.element?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        void navigator.clipboard
          ?.readText()
          .then((t) => {
            if (t) wsSend('term:input', { id: activeId, data: t });
          })
          .catch(() => {});
      });

      // Refit when the panel around us resizes (layout splits, window drags).
      let ro: ResizeObserver | undefined;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => fitFn());
        ro.observe(containerRef.current);
      }
      map.set(activeId, {
        term,
        fit: fitFn,
        ro,
        search,
        lastExit: null,
        lastCmd: '',
        lastCwd: cwd ?? null,
      });

      // Flush anything buffered before this terminal existed.
      const buf = buffers.get(activeId);
      if (buf) {
        buf.forEach((d) => term.write(d));
        buffers.delete(activeId);
      }
    })();

    return () => {
      disposed = true;
      if (!activeId) return;
      const entry = map.get(activeId);
      if (entry) {
        entry.ro?.disconnect();
        try {
          entry.term.dispose();
        } catch {
          /* already gone */
        }
        map.delete(activeId);
      }
    };
  }, [activeId]);

  // Re-color terminals after a theme switch (OLED / dark / light).
  useEffect(() => {
    const map = xtermRefs.current;
    map.forEach((entry) => (entry.term.options.theme = xtermThemeFromCss()));
    setTick((t) => t + 1); // nudge a reflow after palette swap
  }, [theme]);

  function doSearch(q: string) {
    const entry = activeId ? xtermRefs.current.get(activeId) : null;
    if (!entry?.search) return;
    if (q) entry.search.findNext(q);
  }

  /** Phase 4.2: send the failed command + its tail as agent context. */
  function askAgent() {
    const entry = activeId ? xtermRefs.current.get(activeId) : null;
    if (!entry) return;
    const log = commandLog.get(activeId!) ?? [];
    const failed = [...log].reverse().find((c) => c.exitCode !== null && c.exitCode !== 0);
    const cmd = failed?.command ?? entry.lastCmd;
    const out = (failed?.outputTail ?? '').replace(/\x1b\][^\x07]*\x07/g, '').slice(-1500);
    const prompt = `This command failed with exit code ${failed?.exitCode ?? '?'}:\n\n$ ${cmd}\n\nOutput (tail):\n${out}\n\nHelp me fix it.`;
    useStore.setState({ composerPrefill: prompt, composerMode: 'ask' });
    // Bring the agent surface forward via the existing UI event if present.
    window.dispatchEvent(new CustomEvent('aether:focus-composer'));
    setSearchOpen(false);
  }

  function createTerm() {
    if (cwd) wsSend('term:create', { cwd });
  }
  function killTerm(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    wsSend('term:kill', { id });
    setTerms((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
      return next;
    });
  }

  /**
   * Run a suggestion: create (or reuse) a terminal and type the command into
   * it with a trailing Enter. Typed via the pty so the user sees exactly what
   * runs and can Ctrl+C it like any other command — nothing executes silently.
   */
  function runSuggestion(command: string) {
    const target = terms.find((t) => t.id === activeId) ?? terms[terms.length - 1];
    const runIn = (termId: string) => {
      // \r = Enter for the pty; the typed line is visible in scrollback.
      wsSend('term:input', { id: termId, data: `${command}\r` });
    };
    if (target) {
      runIn(target.id);
      setActiveId(target.id);
      return;
    }
    // No terminal yet: create one, then run once it shows up.
    if (cwd) {
      const onCreated = (ev: MessageEvent) => {
        try {
          const { type, payload } = JSON.parse(ev.data);
          if (type === 'term:created') {
            const t = payload as TermInstance;
            runIn(t.id);
            getWs()?.removeEventListener('message', onCreated);
          }
        } catch {
          /* ignore */
        }
      };
      getWs()?.addEventListener('message', onCreated);
      wsSend('term:create', { cwd });
    }
  }

  const active = terms.find((t) => t.id === activeId);
  const activeEntry = activeId ? xtermRefs.current.get(activeId) : null;
  void tick;

  // Exit decoration state for the status strip (gutter markers live in the
  // status line below the terminal — readable, doesn't fight prompt rendering).
  const lastExit = activeEntry?.lastExit ?? null;

  return (
    <div className="term-panel">
      <div className="term-tabs">
        {terms.map((t) => (
          <span
            key={t.id}
            className={`term-tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(t.id)}
            title={t.cwd || t.title}
          >
            <span className={`term-tab-dot ${t.integrated ? 'integrated' : ''}`} />
            {t.title}
            <button
              className="term-tab-close"
              onClick={(e) => killTerm(t.id, e)}
              title="Kill terminal"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {/* Liquid Glass new-terminal button */}
        <GlassButton className="btn-glass glass term-new" onClick={createTerm} title="New terminal">
          <Plus size={13} />
        </GlassButton>
        <div className="term-tabs-spacer" />
        <button
          className={`term-search-btn ${searchOpen ? 'on' : ''}`}
          title="Search scrollback (Ctrl+F)"
          onClick={() => {
            setSearchOpen((v) => !v);
            setTimeout(() => searchRef.current?.focus(), 30);
          }}
        >
          <Search size={12} />
        </button>
        <span className="term-cwd" title={active?.cwd ?? cwd}>
          {active?.cwd ?? cwd}
        </span>
      </div>
      {searchOpen && (
        <div className="term-search-bar fade-in">
          <input
            ref={searchRef}
            placeholder="Search scrollback…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') {
                setSearchOpen(false);
                activeEntry?.search?.clearDecorations?.();
              }
            }}
            onChange={(e) => doSearch(e.target.value)}
          />
          <button
            title="Close"
            onClick={() => {
              setSearchOpen(false);
              activeEntry?.search?.clearDecorations?.();
            }}
          >
            <X size={11} />
          </button>
        </div>
      )}
      <div className="term-stage">
        <div ref={containerRef} className="terminal-container" />
        {terms.length === 0 && (
          <div className="term-idle">
            {suggestions.length > 0 ? (
              <>
                <span className="term-idle-caption">Run in this project</span>
                {suggestions.map((s) => (
                  <button
                    key={s.command}
                    className="term-idle-hint"
                    onClick={() => runSuggestion(s.command)}
                    title={`Run: ${s.command}`}
                  >
                    <Play size={9} /> {s.label}
                  </button>
                ))}
              </>
            ) : (
              <span className="term-idle-hint" onClick={createTerm}>
                + New terminal
              </span>
            )}
          </div>
        )}
        {terms.length > 0 && suggestions.length > 0 && (
          <div className="term-suggest-row" aria-label="Suggested commands">
            {suggestions.slice(0, 4).map((s) => (
              <button
                key={s.command}
                className="term-idle-hint"
                onClick={() => runSuggestion(s.command)}
                title={`Run in terminal: ${s.command}`}
              >
                <Play size={9} /> {s.label}
              </button>
            ))}
          </div>
        )}
        {suggestion && (
          <button
            className="term-suggest fade-in"
            title="Insert into composer as an Ask prompt — never auto-executed"
            onClick={askAgent}
          >
            <Sparkles size={11} />
            <span>
              Ask agent about: <code>{suggestion.slice(0, 48)}</code>
            </span>
            <X
              size={11}
              onClick={(e) => {
                e.stopPropagation();
                setSuggestion(null);
              }}
            />
          </button>
        )}
      </div>
      {/* Status strip: exit decoration + Ask Agent affordance (Phase 4.2) */}
      <div className="term-status">
        {lastExit !== null &&
          (lastExit === 0 ? (
            <span className="term-exit ok">
              <CircleCheck size={11} /> last command ok
            </span>
          ) : (
            <span className="term-exit fail">
              <CircleX size={11} /> exit {lastExit}
            </span>
          ))}
        {lastExit !== null && lastExit !== 0 && (
          <button className="term-ask-agent" onClick={askAgent}>
            <Sparkles size={11} /> Ask Agent to fix
          </button>
        )}
        <span className="term-status-spacer" />
        <span className="term-status-hint">
          {active?.integrated === false ? 'basic shell' : 'integrated'}
        </span>
      </div>
    </div>
  );
}
