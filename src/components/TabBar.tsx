import React from 'react';
import { X, Eye, GitBranch, GitCompare, GitPullRequestArrow, Search, Sparkles, PanelsTopLeft, FileText } from 'lucide-react';
import { TechIcon } from './TechIcon';
import { techNameForFile } from '../lib/techIconMap';
import { getFileIcon } from '../utils/fileIcons';
import { useStore } from '../lib/store';

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const dirtyFiles = useStore((s) => s.dirtyFiles);

  return (
    <div className="tabbar">
      {tabs.map((t) => {
        const dirty = !!t.path && (dirtyFiles as string[]).includes(t.path);
        return (
        <div
          key={t.id}
          className={`tab ${t.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(t.id)}
          onAuxClick={(e) => { if (e.button === 1) closeTab(t.id); }}
          title={t.title}
        >
          <span className="tab-icon">{tabIcon(t.kind, t.title)}</span>
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
          <span>{t.title}{t.preview && <Eye size={10} style={{ marginLeft: 4 }} />}</span>
          {!t.pinned && (
            <span className="close" title="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></span>
          )}
        </div>
        );
      })}
    </div>
  );
}

function tabIcon(kind: string, title: string): React.ReactNode {
  switch (kind) {
    case 'diff': return <GitCompare size={12} className="icon-run" />;
    case 'git': return <GitBranch size={12} />;
    case 'review': return <GitPullRequestArrow size={12} className="icon-warn" />;
    case 'search': return <Search size={12} />;
    case 'skills': return <Sparkles size={12} className="icon-warn" />;
    case 'map': return <PanelsTopLeft size={12} />;
    case 'settings': return <FileText size={12} />;
    default: {
      // vscode-icons SVG matching the file tree; generic file icon fallback.
      // src is memoized in the resolver, so tab re-renders are cheap.
      return (
        <img
          src={getFileIcon(title, false)}
          width={14}
          height={14}
          alt=""
          aria-hidden
          draggable={false}
          style={{ flexShrink: 0 }}
          onError={(e) => { e.currentTarget.src = '/icons/vscode/default_file.svg'; }}
        />
      );
    }
  }
}
