import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Plus, History } from 'lucide-react';
import { useStore } from '../lib/store';
import type { ChatMessage } from '../../shared/types';

/** Chat session viewer — the Composer (bottom-pinned) handles all input.
 *  This panel is now read-only message display + session switcher. */
export function ChatPanel() {
  const sessions = useStore((s) => s.chatSessions);
  const activeChatId = useStore((s) => s.activeChatId);
  const newChat = useStore((s) => s.newChat);
  const selectChat = useStore((s) => s.selectChat);
  const chatStreaming = useStore((s) => s.chatStreaming);
  const [showSessions, setShowSessions] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === activeChatId);
  const messages = session?.messages ?? [];

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages]);

  const tree = useStore((s) => s.tree);
  const [mention, setMention] = useState<string | null>(null);

  function insertMention(path: string) {
    setMention(null);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    // Files dropped here are handled by the Composer's attachment support.
    // The Composer reads the next drag's files when it becomes active.
  }

  return (
    <div className="chat" onDrop={onDrop} onDragOver={(e) => e.preventDefault()} style={{ flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <button onClick={() => setShowSessions((v) => !v)} title="Chat sessions"><History size={13} /></button>
        <button onClick={newChat} title="New chat session"><Plus size={13} /></button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Composer below</span>
      </div>

      {showSessions && (
        <div style={{ borderBottom: '1px solid var(--border)', maxHeight: 160, overflow: 'auto' }}>
          {sessions.length === 0 && <div className="activity-item"><span className="label" style={{ color: 'var(--text-faint)' }}>No sessions yet</span></div>}
          {sessions.map((s) => (
            <div key={s.id} className={`activity-item ${s.id === activeChatId ? '' : ''}`} style={{ cursor: 'pointer' }} onClick={() => selectChat(s.id)}>
              <span className="label">{s.title}</span>
              <button className="danger" onClick={(e) => { e.stopPropagation(); useStore.getState().deleteChat(s.id); }}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {mention !== null && tree && (
        <div style={{ borderBottom: '1px solid var(--border)', maxHeight: 120, overflow: 'auto' }}>
          {flatten(tree).filter((p) => p.toLowerCase().includes((mention ?? '').toLowerCase())).slice(0, 10).map((p) => (
            <div key={p} className="activity-item" style={{ cursor: 'pointer' }} onClick={() => insertMention(p)}>
              <span className="label">@{p}</span>
            </div>
          ))}
        </div>
      )}

      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="empty-state" style={{ height: '100%' }}>
            <div>Agent · Ask · Plan</div>
            <div style={{ fontSize: 11, textAlign: 'center' }}>
              Ask for code, refactors, new features, or whole projects.<br />Use the composer below to send.
            </div>
          </div>
        )}
        {messages.map((m) => <Message key={m.id} m={m} />)}
      </div>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  const tasks = useStore((s) => s.tasks);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const agentStream = useStore((s) => s.agentStream);
  const task = m.taskId ? tasks.find((t) => t.id === m.taskId) : activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;

  return (
    <div className={`msg ${m.role} fade-in ${m.error ? 'error' : ''}`}>
      <span className="role">{m.role === 'user' ? 'You' : 'Aether'}</span>
      <div className="bubble">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || '…'}</ReactMarkdown>
        {m.pending && task && agentStream[task.id] && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentStream[task.id]}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}

function flatten(node: { path: string; type: string; children?: { path: string; type: string; children?: unknown }[] }): string[] {
  const out: string[] = [];
  const walk = (n: { path: string; type: string; children?: { path: string; type: string; children?: unknown }[] }) => {
    if (n.path && n.type === 'file') out.push(n.path);
    n.children?.forEach((c) => walk(c as never));
  };
  walk(node as never);
  return out;
}
