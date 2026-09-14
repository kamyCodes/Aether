import React from 'react';
import {
  Sparkles,
  Compass,
  FlaskConical,
  Bug,
  FolderPlus,
  GitBranch,
  Command,
  History,
  Wand2,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { promptDialog } from '../lib/dialogs';
import { TechIcon } from './TechIcon';
import { techIconMap } from '../lib/techIconMap';
import { getWelcomeContext } from '../utils/welcomeContext';
import type { WelcomeCard } from '../utils/welcomeContext';

const CARD_ICONS = {
  sparkles: Sparkles,
  compass: Compass,
  flask: FlaskConical,
  bug: Bug,
  git: GitBranch,
  history: History,
  folder: FolderPlus,
  wand: Wand2,
} as const;

export function WelcomeScreen({ onOpenPalette }: { onOpenPalette: () => void }) {
  const workspaces = useStore((s) => s.workspaces);
  const workspaceId = useStore((s) => s.workspaceId);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const startTask = useStore((s) => s.startTask);
  const openTab = useStore((s) => s.openTab);
  const connected = useStore((s) => s.omniConnected);
  const tree = useStore((s) => s.tree);
  const tasks = useStore((s) => s.tasks);
  const dirtyFiles = useStore((s) => s.dirtyFiles);
  const current = workspaces.find((w) => w.id === workspaceId);

  const fileCount = React.useMemo(() => {
    let n = 0;
    const walk = (node: { type: string; children?: { type: string; children?: unknown }[] }) => {
      if (node.type === 'file') n++;
      node.children?.forEach((c) => walk(c as never));
    };
    if (tree) walk(tree as never);
    return n;
  }, [tree]);

  // Dynamic welcome content: greeting + suggested cards derived from live
  // workspace state (pure function over store data, recomputed only when
  // one of its inputs actually changes).
  const dirty = Array.isArray(dirtyFiles) ? dirtyFiles : [...dirtyFiles];
  const welcome = React.useMemo(
    () =>
      getWelcomeContext({
        hasWorkspace: !!current,
        workspaceName: current?.name,
        tree,
        tasks,
        dirtyFiles: dirty,
      }),
    [current?.name, tree, tasks, dirty],
  );

  const recent = workspaces.slice(0, 4);

  const runCard = React.useCallback(
    async (card: WelcomeCard) => {
      if (card.id === 'add-folder') {
        const root = await promptDialog({
          title: 'Add workspace folder',
          placeholder: 'Absolute folder path…',
          folderPicker: true,
          confirmLabel: 'Add',
        });
        if (root) void addWorkspace(root);
        return;
      }
      // Review opens the real diff view instead of spawning an agent task.
      if (card.id === 'review-changes') {
        openTab({ kind: 'review', title: 'Review Changes' });
        return;
      }
      void startTask(card.prompt, 'agent');
    },
    [addWorkspace, openTab, startTask],
  );

  // Detect the workspace's tech stack from file names in the tree.
  const detected = React.useMemo(() => {
    const hits = new Set<string>();
    const walk = (node: {
      name?: string;
      type: string;
      children?: { name?: string; type: string; children?: unknown }[];
    }) => {
      const fileName = (node.name ?? '').toLowerCase();
      if (fileName) {
        if (fileName === 'package.json') hits.add('nodejs');
        const ext = fileName.includes('.') ? fileName.split('.').pop()! : '';
        if (
          [
            'ts',
            'tsx',
            'js',
            'jsx',
            'py',
            'rs',
            'go',
            'css',
            'scss',
            'html',
            'md',
            'vue',
            'svelte',
          ].includes(ext)
        )
          hits.add(ext);
      }
      node.children?.forEach((c) => walk(c as never));
    };
    if (tree) walk(tree as never);
    // Keep a stable, curated order from the map.
    return [...hits].filter((h) => h in techIconMap).slice(0, 10);
  }, [tree]);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1 className="welcome-title">What should we build today?</h1>
        <p className="welcome-sub">{welcome.message}</p>

        <div className="welcome-grid">
          {welcome.cards.map((card) => {
            const Icon = CARD_ICONS[card.icon];
            return (
              <button
                key={card.id}
                className="welcome-card"
                disabled={!current && card.id !== 'add-folder'}
                onClick={() => current !== undefined && void runCard(card)}
                title={card.prompt || 'Open a folder'}
              >
                <span className="welcome-card-icon">
                  <Icon size={15} />
                </span>
                <span className="welcome-card-label">{card.label}</span>
                {card.prompt && <span className="welcome-card-prompt">{card.prompt}</span>}
              </button>
            );
          })}
        </div>

        <div className="welcome-recent">
          <div className="welcome-recent-head">
            <span>Recent projects</span>
            <button onClick={onOpenPalette} title="Command Palette (Ctrl+K)">
              <Command size={11} /> K
            </button>
          </div>
          {recent.length > 0 ? (
            <div className="welcome-recent-list">
              {recent.map((w) => (
                <button
                  key={w.id}
                  className={`welcome-project ${w.id === workspaceId ? 'current' : ''}`}
                  onClick={() => openTab({ kind: 'map', title: 'Codebase Map' })}
                  title={w.root}
                >
                  <FolderPlus size={13} className="icon-dim" />
                  <span className="welcome-project-name">{w.name}</span>
                  <span className="welcome-project-meta">
                    {w.id === workspaceId ? fileCount : w.fileCount} files{w.git ? ' · git' : ''}
                  </span>
                  {w.id === workspaceId && <span className="badge on">current</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="welcome-recent-empty">
              No projects yet — add a folder to get started.
              <button
                className="primary"
                onClick={async () => {
                  const root = await promptDialog({
                    title: 'Add workspace folder',
                    placeholder: 'Absolute folder path…',
                    folderPicker: true,
                    confirmLabel: 'Add',
                  });
                  if (root) void addWorkspace(root);
                }}
              >
                <FolderPlus size={13} /> Add Folder
              </button>
            </div>
          )}
        </div>

        <div
          className="welcome-foot"
          style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}
        >
          <GitBranch size={12} className="icon-dim" />
          <span>
            {connected
              ? 'Aether endpoint connected — models are ready.'
              : 'Aether endpoint is offline — set it in Settings to enable the agent.'}
          </span>
        </div>

        {/* TechIcon stack badges for this workspace.
            Built from files actually present in the workspace tree. */}
        {detected.length > 0 && (
          <div className="welcome-stack" title="Detected technologies in this workspace">
            {detected.map((name) => (
              <TechIcon key={name} name={name} size={18} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
