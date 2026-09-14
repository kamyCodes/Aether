import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Command, Settings, PanelLeft, PanelRight, PanelBottom, X } from 'lucide-react';
import { AetherMark } from './lib/AetherMark';
import { useStore } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { EditorView } from './components/EditorView';
import { AgentChat } from './components/AgentChat';
import { Composer } from './components/Composer';
import { TerminalPanel } from './components/TerminalPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { ContextMonitor } from './components/ContextMonitor';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/SettingsModal';
import { SearchPanel } from './components/SearchPanel';
import { GitPanel } from './components/GitPanel';
import { SkillsPanel } from './components/SkillsPanel';
import { MapPanel } from './components/MapPanel';
import { Resizer } from './components/Resizer';
import { GlassSegmentedControl } from './components/glass';
import { Dialogs } from './components/Dialogs';
import { Toasts } from './components/Toasts';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ReviewPanel } from './components/ReviewPanel';
import { mountGlassInteractions } from './lib/glass';
import type { OpenTab } from './lib/store';

export default function App() {
  const init = useStore((s) => s.init);
  const workspaceId = useStore((s) => s.workspaceId);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const theme = useStore((s) => s.settings?.ui.theme ?? 'dark');
  const accent = useStore((s) => s.settings?.ui.accent ?? '#6E62E5');
  const rightTab = useStore((s) => (s.activeChatId ? 'chat' : 'chat')) as string;
  const setRightTab = useState(rightTab)[1];

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);

  // Liquid Glass interaction layer (glow / shine / segmented indicator) —
  // delegated listeners mounted once; no component logic involved.
  useEffect(() => mountGlassInteractions(), []);
  const [bottomHeight, setBottomHeight] = useState(240);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'preview'>('terminal');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showBottom, setShowBottom] = useState(true);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = theme;
      root.style.setProperty('--accent', accent);
    };
    // Mirror for the pre-React inline script in index.html, so the next page
    // load starts on the right theme with no flash.
    try {
      localStorage.setItem('aether-theme', theme);
    } catch {
      /* private mode */
    }
    // Cross-fade the whole UI when the theme flips (View Transitions API —
    // Chromium; other browsers apply instantly). Skip on first mount: no
    // old state to fade from, and the pre-React script already set it.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (root.dataset.theme && root.dataset.theme !== theme && doc.startViewTransition) {
      void doc.startViewTransition(apply);
    } else {
      apply();
    }
  }, [theme, accent]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const st = useStore.getState();
      const tab = st.tabs.find((t) => t.id === st.activeTabId);
      if (tab?.path && st.fileContents[tab.path] !== undefined) {
        void st.saveFile(tab.path, st.fileContents[tab.path]);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      setSettingsOpen(true);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      setShowSidebar((v) => !v);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      setShowBottom((v) => !v);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  // Continuous layout scaling: compact windows shed panels gracefully
  // instead of crushing the editor canvas to zero width.
  useEffect(() => {
    let prev = window.innerWidth;
    let prevH = window.innerHeight;
    setShowSidebar(prev >= 1100);
    setShowRight(prev >= 820);
    setShowBottom(prevH >= 560);
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w < 1100 && prev >= 1100) setShowSidebar(false);
      if (w >= 1240 && prev < 1100) setShowSidebar(true);
      if (w < 820 && prev >= 820) setShowRight(false);
      if (w >= 960 && prev < 820) setShowRight(true);
      if (h < 560 && prevH >= 560) setShowBottom(false);
      if (h >= 680 && prevH < 560) setShowBottom(true);
      prev = w;
      prevH = h;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  void setRightTab;
  void rightTab;

  return (
    <div className="app">
      <div className="titlebar">
        <div className="traffic-lights">
          <button
            className="tl close"
            title="Close tab"
            onClick={() => {
              const st = useStore.getState();
              if (st.activeTabId) st.closeTab(st.activeTabId);
            }}
          />
          <button
            className="tl min"
            title="Toggle terminal panel"
            onClick={() => setShowBottom((v) => !v)}
          />
          <button
            className="tl max"
            title="Toggle focus mode (hide panels)"
            onClick={() => {
              setShowSidebar((s) => !s);
              setShowRight((s) => !s);
            }}
          />
        </div>
        <span className="logo">
          <AetherMark size={16} /> Aether
        </span>
        <span className="logo-tagline">Build with agents.</span>
        <div className="title-center">
          {/* Command-palette entry point: read-only input that opens the
              palette on focus/click; filtering lives in CommandPalette. */}
          <input
            className="global-search"
            readOnly
            placeholder="Ask Aether, search your codebase, or run a command..."
            onClick={() => setPaletteOpen(true)}
            onFocus={(e) => {
              e.currentTarget.blur();
              setPaletteOpen(true);
            }}
            aria-label="Command palette (Ctrl+K)"
          />
          <span className="global-search-hint" title="Open command palette">
            ⌘K
          </span>
        </div>
        <div className="spacer" />
        <button
          className="tb-icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings (Ctrl+,)"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
        <button
          className="tb-icon-btn"
          onClick={() => setShowSidebar((v) => !v)}
          title="Toggle sidebar (Ctrl+B)"
          aria-label="Toggle sidebar"
        >
          <PanelLeft size={14} />
        </button>
        <button
          className="tb-icon-btn"
          onClick={() => setShowRight((v) => !v)}
          title="Toggle AI panel (chat & agent)"
          aria-label="Toggle AI panel"
        >
          <PanelRight size={14} />
        </button>
        <button
          className="tb-icon-btn"
          onClick={() => setShowBottom((v) => !v)}
          title="Toggle terminal (Ctrl+J)"
          aria-label="Toggle terminal"
        >
          <PanelBottom size={14} />
        </button>
      </div>

      <div className="main">
        {showSidebar && (
          <>
            <div style={{ width: sidebarWidth }} className="panel sidebar">
              <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
            </div>
            <Resizer vertical onResize={setSidebarWidth} />
          </>
        )}

        <div className="editor-area">
          <TabBar />
          <div className="editor-canvas">
            {activeTab?.kind === 'search' ? (
              <SearchPanel />
            ) : activeTab?.kind === 'git' ? (
              <GitPanel />
            ) : activeTab?.kind === 'review' ? (
              <ReviewPanel />
            ) : activeTab?.kind === 'skills' ? (
              <SkillsPanel />
            ) : activeTab?.kind === 'map' ? (
              <MapPanel />
            ) : activeTab?.kind === 'settings' ? (
              <div className="panel-body">
                <SettingsInline onOpen={() => setSettingsOpen(true)} />
              </div>
            ) : activeTab?.kind === 'diff' ? (
              <EditorView tab={activeTab} />
            ) : activeTab?.kind === 'file' ? (
              <EditorView tab={activeTab} />
            ) : (
              <WelcomeScreen onOpenPalette={() => setPaletteOpen(true)} />
            )}
          </div>
          {showBottom && (
            <>
              <Resizer horizontal reverse onResize={setBottomHeight} />
              <div style={{ height: bottomHeight }} className="panel">
                <div className="panel-header">
                  {/* Liquid Glass: Radix ToggleGroup + layoutId indicator */}
                  <GlassSegmentedControl
                    layoutId="bottom-panel"
                    className="mode-toggle"
                    style={{ textTransform: 'none' }}
                    ariaLabel="Bottom panel"
                    value={bottomTab}
                    onValueChange={(v) => setBottomTab(v as 'terminal' | 'preview')}
                    options={[
                      { value: 'terminal', label: 'Terminal' },
                      { value: 'preview', label: 'Preview' },
                    ]}
                  />
                  <button onClick={() => setShowBottom(false)} title="Close panel">
                    <X size={13} />
                  </button>
                </div>
                {bottomTab === 'terminal' ? <TerminalPanel /> : <PreviewPanel />}
              </div>
            </>
          )}
        </div>

        {showRight && (
          <>
            <Resizer vertical reverse onResize={setRightWidth} />
            <div style={{ width: rightWidth }} className="panel rightbar">
              <div className="panel-header">
                {/* Single-segment header (no switching) — glass segmented keeps
                    the visual language consistent with the other toggles. */}
                <GlassSegmentedControl
                  layoutId="right-panel-header"
                  className="mode-toggle"
                  style={{ textTransform: 'none' }}
                  ariaLabel="Panel"
                  value="chat"
                  onValueChange={() => {}}
                  options={[{ value: 'chat', label: 'Chat & Agent' }]}
                />
                <button
                  className="palette-hint"
                  onClick={() => setPaletteOpen(true)}
                  title="Open the command palette (Ctrl+K)"
                >
                  <Command size={10} /> Ctrl+K
                </button>
              </div>
              <AgentChat />
              <Composer />
              <ContextMonitor />
            </div>
          </>
        )}
      </div>

      <StatusBar />
      <Toasts />
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <Dialogs />
      {/* Liquid Glass refraction filter — must exist EXACTLY ONCE in the app
          shell; the shared .glass class references it by id. Chromium only —
          other engines keep the plain-blur fallback declared before it. */}
      <svg
        width="0"
        height="0"
        style={{ position: 'absolute' }}
        aria-hidden="true"
        focusable="false"
      >
        <filter
          id="glass-distortion"
          colorInterpolationFilters="sRGB"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.008"
            numOctaves={2}
            seed={4}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation={2} result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale={30}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
    </div>
  );
}

function SettingsInline({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty-state">
      <div>Editor settings are under Settings</div>
      <button className="primary" onClick={onOpen}>
        Open Settings
      </button>
    </div>
  );
}
