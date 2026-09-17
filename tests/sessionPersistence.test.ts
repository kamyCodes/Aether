import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Per-workspace session persistence (server/chats.ts + TerminalManager tab
 * metadata): chat threads and terminal tabs must survive an app restart.
 * The sandbox is set ONCE at module scope, BEFORE any dynamic import —
 * config.ts resolves DATA_DIR into a module-level constant, so per-test
 * env changes after the first import would silently not apply (module
 * cache). Isolation across tests comes from unique workspace ids/paths.
 */

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-sessions-'));
process.env.AETHER_HOME = home;

async function freshStores() {
  // Dynamic import: each sandbox gets a fresh module registry evaluation of
  // DATA_DIR, so no cross-test leakage through the module-level constant.
  const [{ ChatSessionStore }, { TerminalManager }] = await Promise.all([
    import('../server/chats.js'),
    import('../server/terminal.js'),
  ]);
  return { ChatSessionStore, TerminalManager };
}

test('chat threads persist per workspace and survive a store restart', async () => {
  const { ChatSessionStore } = await freshStores();
  const wsA = 'd29ya3NwYWNlLUE';
  const wsB = 'd29ya3NwYWNlLUI';

  const first = new ChatSessionStore();
  first.save({
    workspaceId: wsA,
    savedAt: 0,
    activeChatId: 'chat-2',
    chatTaskId: 'task-9',
    activeTaskId: null,
    sessions: [
      { id: 'chat-1', title: 'First thread', createdAt: 1, messages: [{ role: 'user', content: 'hello' }] },
      { id: 'chat-2', title: 'Second thread', createdAt: 2, messages: [{ role: 'assistant', content: 'hi there' }] },
    ],
  });
  first.save({
    workspaceId: wsB,
    savedAt: 0,
    activeChatId: null,
    chatTaskId: null,
    activeTaskId: 'task-3',
    sessions: [{ id: 'chat-B1', title: 'B thread', createdAt: 5, messages: [] }],
  });
  // Debounce is 800ms — flush it.
  await new Promise((r) => setTimeout(r, 1000));

  // "Restart": a brand-new store instance over the same DATA_DIR.
  const second = new ChatSessionStore();
  const restoredA = await second.get(wsA);
  const restoredB = await second.get(wsB);

  assert.ok(restoredA, 'workspace A threads must persist');
  assert.equal(restoredA!.sessions.length, 2);
  assert.equal(restoredA!.activeChatId, 'chat-2');
  assert.equal(restoredA!.chatTaskId, 'task-9');
  assert.equal(restoredA!.sessions[1].id, 'chat-2');

  assert.ok(restoredB, 'workspace B threads must persist independently');
  assert.equal(restoredB!.sessions[0].id, 'chat-B1');
  assert.equal(restoredB!.activeTaskId, 'task-3');
});

test('chat store clamps runaway state (session cap, oversized messages)', async () => {
  const { ChatSessionStore } = await freshStores();
  const ws = 'd2lkZ2V0LWNhcA';
  const store = new ChatSessionStore();

  const many = Array.from({ length: 45 }, (_, i) => ({
    id: `s${i}`,
    title: `t${i}`,
    createdAt: i,
    messages: [],
  }));
  const huge = 'x'.repeat(300_000);
  store.save({
    workspaceId: ws,
    savedAt: 0,
    activeChatId: null,
    chatTaskId: null,
    activeTaskId: null,
    sessions: [...many, { id: 'huge', title: 'h', createdAt: 999, messages: [{ role: 'user', content: huge }] }],
  });
  await new Promise((r) => setTimeout(r, 1000));

  const restored = await new ChatSessionStore().get(ws);
  assert.ok(restored);
  assert.equal(restored!.sessions.length, 30, 'session cap (30) must hold');
  assert.equal(restored!.sessions.at(-1)!.id, 'huge', 'newest sessions win');
  const stored = JSON.stringify(restored);
  assert.ok(stored.length < 250_000, 'oversized messages must truncate');
});

test('deleteChat removes the workspace file; unknown reads yield null', async () => {
  const { ChatSessionStore } = await freshStores();
  const ws = 'ZGVsZXRlLW1l';
  const store = new ChatSessionStore();
  store.save({
    workspaceId: ws,
    savedAt: 0,
    activeChatId: null,
    chatTaskId: null,
    activeTaskId: null,
    sessions: [{ id: 'c', title: 'c', createdAt: 1, messages: [] }],
  });
  await new Promise((r) => setTimeout(r, 1000));

  await store.delete(ws);
  assert.equal(await store.get(ws), null, 'file must be gone after delete');
  assert.equal(await store.get('never-existed'), null);
});

test('terminal tab metadata: persisted list survives a manager restart and is cleared on ack', async () => {
  const { TerminalManager } = await freshStores();
  const tabsFile = path.join(home, 'terminals.json');

  // Simulate the previous run: write tab metadata the way persistTabs does.
  fs.writeFileSync(
    tabsFile,
    JSON.stringify({
      tabs: [
        { id: 't1', title: 'JARVIS', cwd: 'C:\\proj', workspaceId: 'ws-1', createdAt: 1 },
        { id: 't2', title: 'aux', cwd: 'C:\\proj\\lib', workspaceId: 'ws-1', createdAt: 2 },
      ],
      savedAt: 3,
    }),
    'utf8',
  );

  // "Restart": a fresh manager loads the dead-tab stash at construction.
  const mgr = new TerminalManager();
  const persisted = mgr.loadPersistedTabs();
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].workspaceId, 'ws-1');
  assert.equal(persisted[1].cwd, 'C:\\proj\\lib');

  // Client revives only t1 → stash keeps t1, drops t2.
  await mgr.replaceDeadTabs([{ id: 't1', title: 'JARVIS', cwd: 'C:\\proj', workspaceId: 'ws-1', createdAt: 1 }]);
  const afterAck = mgr.loadPersistedTabs();
  assert.equal(afterAck.length, 1);
  assert.equal(afterAck[0].id, 't1');

  // The rewritten file reflects the ack (a later restart sees only t1).
  const onDisk = JSON.parse(fs.readFileSync(tabsFile, 'utf8')) as { tabs: { id: string }[] };
  assert.deepEqual(onDisk.tabs.map((t) => t.id), ['t1']);

  // Full clear (client dismissed everything) empties the stash and file.
  await mgr.replaceDeadTabs([]);
  assert.equal(mgr.loadPersistedTabs().length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(tabsFile, 'utf8')).tabs, []);
});

test('terminal manager with no prior state starts with an empty persisted list', async () => {
  const { TerminalManager } = await freshStores();
  const mgr = new TerminalManager();
  assert.deepEqual(mgr.loadPersistedTabs(), []);
});
