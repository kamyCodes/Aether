import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  GitBranch,
  ChevronRight,
  ChevronDown,
  Folder,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  X,
} from 'lucide-react';
import { TechIcon } from './TechIcon';
import { GlassSegmentedControl, GlassButton } from './glass';
import { techNameForFile } from '../lib/techIconMap';
import { getFileIcon } from '../utils/fileIcons';
import { promptDialog, confirmDialog } from '../lib/dialogs';
import { useStore } from '../lib/store';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import type { FileNode } from '../../shared/types';

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function Sidebar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const tree = useStore((s) => s.tree);
  const workspaces = useStore((s) => s.workspaces);
  const workspaceId = useStore((s) => s.workspaceId);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const closeWorkspace = useStore((s) => s.closeWorkspace);
  const openTab = useStore((s) => s.openTab);
  const workspaceName = useStore((s) => s.workspaces.find((w) => w.id === s.workspaceId)?.name);
  const createFile = useStore((s) => s.createFile);
  const createFolder = useStore((s) => s.createFolder);
  const deleteEntry = useStore((s) => s.deleteEntry);
  const gitStatuses = useStore((s) => s.gitStatuses);
  const [view, setView] = useState<'explorer' | 'ws'>('explorer');
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Directories containing at least one modified/untracked file — used for
  // aggregate folder badges. Recomputed only when statuses change.
  const dirtyDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const p of Object.keys(gitStatuses)) {
      const parts = p.split('/');
      parts.pop();
      let cur = '';
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        dirs.add(cur);
      }
    }
    return dirs;
  }, [gitStatuses]);

  const newFileIn = async (dir?: string) => {
    const name = await promptDialog({
      title: dir ? `New file in ${dir}` : 'New file in workspace root',
      placeholder: 'file name (e.g. index.ts or src/app.tsx)',
      confirmLabel: 'Create',
    });
    if (name?.trim()) await createFile(dir ? `${dir}/${name.trim()}` : name.trim());
  };
  const newFolderIn = async (dir?: string) => {
    const name = await promptDialog({
      title: dir ? `New folder in ${dir}` : 'New folder in workspace root',
      placeholder: 'folder name',
      confirmLabel: 'Create',
    });
    if (name?.trim()) await createFolder(dir ? `${dir}/${name.trim()}` : name.trim());
  };

  // Root-area context menu (right-click on the panel body / empty space).
  const openRootMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'New File…',
          icon: <FilePlus size={12} />,
          onSelect: () => void newFileIn(undefined),
        },
        {
          label: 'New Folder…',
          icon: <FolderPlus size={12} />,
          onSelect: () => void newFolderIn(undefined),
        },
      ],
    });
  };

  // Root as a drop target: dropping outside any folder moves to workspace root.
  const [rootDragOver, setRootDragOver] = useState(false);
  const onRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    const from = e.dataTransfer.getData('text/aether-path');
    if (!from || !from.includes('/')) return; // nothing dragged or already at root
    const name = from.split('/').pop()!;
    await useStore.getState().renameEntry(from, name);
  };

  return (
    <>
      <div className="panel-header">
        {/* Liquid Glass: Radix ToggleGroup + layoutId indicator */}
        <GlassSegmentedControl
          layoutId="sidebar-view"
          className="mode-toggle"
          style={{ textTransform: 'none' }}
          ariaLabel="Sidebar view"
          value={view}
          onValueChange={(v) => setView(v as 'explorer' | 'ws')}
          options={[
            { value: 'explorer', label: 'Files' },
            { value: 'ws', label: 'Projects' },
          ]}
        />
      </div>
      <div
        className={`panel-body ${rootDragOver ? 'drop-target' : ''}`}
        onContextMenu={view === 'explorer' && tree ? openRootMenu : undefined}
        onDragOver={(e) => {
          if (view === 'explorer' && e.dataTransfer.types.includes('text/aether-path')) {
            e.preventDefault();
            setRootDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setRootDragOver(false);
        }}
        onDrop={(e) => void onRootDrop(e)}
      >
        {view === 'ws' ? (
          <div>
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={`tree-item ${w.id === workspaceId ? 'active' : ''}`}
                onClick={() => void selectWorkspace(w.id)}
              >
                <Folder size={12} className="icon-run" />
                <span className="ws-name" title={w.root}>
                  {w.name}
                </span>
                {w.git && (
                  <span className="badge" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    git
                  </span>
                )}
                <button
                  className="ws-close"
                  title={`Close workspace "${w.name}" (files on disk are untouched)`}
                  aria-label={`Close workspace ${w.name}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirmDialog({
                      title: `Close workspace "${w.name}"?`,
                      message:
                        'Aether stops watching this folder and removes it from the workspace list. Files on disk are not touched — reopen the folder any time.',
                      confirmLabel: 'Close workspace',
                      danger: true,
                    });
                    if (ok) await closeWorkspace(w.id);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            <div style={{ padding: 10 }}>
              <button
                className="primary"
                style={{ width: '100%' }}
                onClick={async () => {
                  const root = await promptDialog({
                    title: 'Add workspace folder',
                    placeholder: 'Absolute folder path…',
                    folderPicker: true,
                    confirmLabel: 'Add',
                  });
                  if (root) await addWorkspace(root);
                }}
              >
                + Add Workspace Folder
              </button>
            </div>
          </div>
        ) : tree ? (
          <>
            <div className="tree-actions">
              <button title="New file in root" onClick={() => void newFileIn(undefined)}>
                <FilePlus size={12} />
              </button>
              <button title="New folder in root" onClick={() => void newFolderIn(undefined)}>
                <FolderPlus size={12} />
              </button>
            </div>
            {tree.type === 'dir' && (!tree.children || tree.children.length === 0) ? (
              <div className="empty-state">
                <div>This folder is empty</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  {tree.path === '' || !tree.path ? workspaceName : tree.path}
                </div>
              </div>
            ) : (
              <Tree
                node={tree}
                depth={0}
                setMenu={setMenu}
                statuses={gitStatuses}
                dirtyDirs={dirtyDirs}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <div>No workspace</div>
            <button
              className="primary"
              onClick={async () => {
                const root = await promptDialog({
                  title: 'Add workspace folder',
                  placeholder: 'Absolute folder path…',
                  folderPicker: true,
                  confirmLabel: 'Add',
                });
                if (root) await addWorkspace(root);
              }}
            >
              Add Folder
            </button>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {/* Liquid Glass footer actions */}
      <div
        style={{
          padding: '6px 10px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 6,
        }}
      >
        <GlassButton
          className="btn-glass glass sidebar-action"
          onClick={() => openTab({ kind: 'search', title: 'Search' })}
        >
          <Search size={12} /> Search
        </GlassButton>
        <GlassButton
          className="btn-glass glass sidebar-action"
          onClick={() => openTab({ kind: 'git', title: 'Git' })}
        >
          <GitBranch size={12} /> Git
        </GlassButton>
      </div>
    </>
  );
}

function Tree({
  node,
  depth,
  setMenu,
  statuses,
  dirtyDirs,
}: {
  node: FileNode;
  depth: number;
  setMenu: (m: MenuState | null) => void;
  statuses: Record<string, 'M' | 'U' | 'D'>;
  dirtyDirs: Set<string>;
}) {
  const openFile = useStore((s) => s.openFile);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabs = useStore((s) => s.tabs);
  const createFile = useStore((s) => s.createFile);
  const createFolder = useStore((s) => s.createFolder);
  const renameEntry = useStore((s) => s.renameEntry);
  const deleteEntry = useStore((s) => s.deleteEntry);
  const [collapsed, setCollapsed] = useState(depth > 0);
  const [dragOver, setDragOver] = useState(false);
  const activePath = tabs.find((t) => t.id === activeTabId)?.path;

  const dragSelf = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/aether-path', node.path);
    e.dataTransfer.effectAllowed = 'move';
  };
  const allowDrop = (e: React.DragEvent) => {
    if (node.type !== 'dir') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };
  const onDrop = async (e: React.DragEvent) => {
    if (node.type !== 'dir') return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const from = e.dataTransfer.getData('text/aether-path');
    if (!from || from === node.path || from.startsWith(`${node.path}/`)) return; // no self/nested drops
    const name = from.split('/').pop()!;
    await renameEntry(from, `${node.path}/${name}`);
  };

  const newFileIn = async () => {
    const name = await promptDialog({
      title: `New file in ${node.path}`,
      placeholder: 'file name',
      confirmLabel: 'Create',
    });
    if (name?.trim()) await createFile(`${node.path}/${name.trim()}`);
  };
  const newFolderIn = async () => {
    const name = await promptDialog({
      title: `New folder in ${node.path}`,
      placeholder: 'folder name',
      confirmLabel: 'Create',
    });
    if (name?.trim()) await createFolder(`${node.path}/${name.trim()}`);
  };

  const rename = async () => {
    const newName = await promptDialog({
      title: `Rename ${node.name}`,
      placeholder: 'new name or path',
      initialValue: node.path,
      confirmLabel: 'Rename',
    });
    if (newName?.trim() && newName.trim() !== node.path)
      await renameEntry(node.path, newName.trim());
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete ${node.name}?`,
      message:
        node.type === 'dir'
          ? `The folder "${node.path}" and everything inside it will be removed from disk. Checkpoints may still hold a copy.`
          : `"${node.path}" will be removed from disk. Checkpoints may still hold a copy.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await deleteEntry(node.path);
  };

  // Right-click menu consolidating all actions for this item.
  const openItemMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      ...(node.type === 'file'
        ? [
            {
              label: 'Open',
              icon: <TechIcon name={techNameForFile(node.name) ?? node.name} size={12} />,
              onSelect: () => void openFile(node.path),
            },
          ]
        : [
            {
              label: collapsed ? 'Expand' : 'Collapse',
              icon: collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />,
              onSelect: () => setCollapsed((c) => !c),
            },
          ]),
      {
        label: 'Copy Path',
        icon: <Copy size={12} />,
        onSelect: () => void navigator.clipboard?.writeText(node.path).catch(() => {}),
      },
      { label: '', separator: true },
      {
        label: 'New File…',
        icon: <FilePlus size={12} />,
        disabled: node.type !== 'dir',
        onSelect: () => void newFileIn(),
      },
      {
        label: 'New Folder…',
        icon: <FolderPlus size={12} />,
        disabled: node.type !== 'dir',
        onSelect: () => void newFolderIn(),
      },
      { label: '', separator: true },
      { label: 'Rename…', icon: <Pencil size={12} />, onSelect: () => void rename() },
      { label: 'Delete…', icon: <Trash2 size={12} />, danger: true, onSelect: () => void remove() },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const itemActions = (
    <span className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
      {node.type === 'dir' && (
        <>
          <button title="New file here" onClick={() => void newFileIn()}>
            <FilePlus size={11} />
          </button>
          <button title="New folder here" onClick={() => void newFolderIn()}>
            <FolderPlus size={11} />
          </button>
        </>
      )}
      <button title="Rename" onClick={() => void rename()}>
        <Pencil size={11} />
      </button>
      <button title="Delete" onClick={() => void remove()}>
        <Trash2 size={11} />
      </button>
    </span>
  );

  if (node.type === 'file') {
    return (
      <div
        className={`tree-item ${activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => void openFile(node.path)}
        onContextMenu={openItemMenu}
        draggable
        onDragStart={dragSelf}
        title={node.path}
      >
        <span className="icon">
          <FileTreeIcon name={node.name} isFolder={false} size={15} status={statuses[node.path]} />
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        {itemActions}
      </div>
    );
  }

  return (
    <div>
      {node.path && (
        <div
          className={`tree-item ${dragOver ? 'drop-target' : ''}`}
          style={{ paddingLeft: 8 + depth * 12, fontWeight: 600, color: 'var(--text)' }}
          onClick={() => setCollapsed((c) => !c)}
          onContextMenu={openItemMenu}
          draggable
          onDragStart={dragSelf}
          onDragOver={allowDrop}
          onDragLeave={(e) => {
            if (e.target === e.currentTarget) setDragOver(false);
          }}
          onDrop={(e) => void onDrop(e)}
        >
          <span className="icon" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span style={{ display: 'inline-flex', width: 12, flexShrink: 0 }}>
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </span>
            <FileTreeIcon
              name={node.name}
              isFolder
              isOpen={!collapsed}
              size={15}
              status={dirtyDirs.has(node.path) ? 'M' : undefined}
              folder
            />
          </span>
          {node.name}
          {itemActions}
        </div>
      )}
      {!collapsed &&
        node.children?.map((c) => (
          <Tree
            key={c.path}
            node={c}
            depth={node.path ? depth + 1 : depth}
            setMenu={setMenu}
            statuses={statuses}
            dirtyDirs={dirtyDirs}
          />
        ))}
    </div>
  );
}

/**
 * vscode-icons SVG for a tree row, with an optional git-status badge
 * overlaid at the corner (M=modified orange, U=untracked green, D=deleted
 * red; folders get a neutral dot since the aggregate state is mixed).
 * Cheap per render: the resolver memoizes name→icon lookups, and React
 * reuses the <img> element between re-renders (same src = no reload).
 */
const GIT_BADGE_LABEL: Record<string, string> = { M: 'Modified', U: 'Untracked', D: 'Deleted' };

const FileTreeIcon = React.memo(function FileTreeIcon({
  name,
  isFolder,
  isOpen,
  size = 15,
  status,
  folder,
}: {
  name: string;
  isFolder: boolean;
  isOpen?: boolean;
  size?: number;
  status?: 'M' | 'U' | 'D';
  /** Folder aggregate: neutral dot instead of a status letter. */
  folder?: boolean;
}) {
  const badge = status ? (
    <span
      className={`git-badge git-badge-${folder ? 'dir' : status}`}
      title={folder ? 'Contains changed files' : GIT_BADGE_LABEL[status]}
    >
      {folder ? '•' : status}
    </span>
  ) : null;
  return (
    <span className="git-icon-wrap" style={{ width: size, height: size }}>
      <img
        src={getFileIcon(name, isFolder, isOpen)}
        width={size}
        height={size}
        alt=""
        aria-hidden
        draggable={false}
        onError={(e) => {
          // Asset missing: swap to the generic icon rather than a broken image.
          const img = e.currentTarget;
          const fallback = isFolder
            ? '/icons/vscode/default_folder.svg'
            : '/icons/vscode/default_file.svg';
          if (!img.src.endsWith(fallback)) img.src = fallback;
        }}
      />
      {badge}
    </span>
  );
});
