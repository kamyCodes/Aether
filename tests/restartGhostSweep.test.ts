import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Restart-ghost sweep: any task persisted in a non-terminal state (running /
 * planning / queued / awaiting-* / paused) died with the previous backend
 * process. HistoryStore.failInterrupted() must rewrite those files as failed
 * BEFORE the restore path runs, so no client can inherit a running ghost
 * from disk.
 *
 * Sandbox is set ONCE at module scope, BEFORE the dynamic import — config.ts
 * resolves DATA_DIR into a module-level constant (see sessionPersistence.test).
 * Isolation between tests comes from unique task ids; a fresh HistoryStore
 * instance per test simulates a fresh process boot over the same files.
 */

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-ghostsweep-'));
process.env.AETHER_HOME = home;

const { HistoryStore } = await import('../server/history.js');

let seq = 0;
function writeTaskFile(overrides: Record<string, unknown>): string {
  const id = `ghost-task-${++seq}-${Math.random().toString(36).slice(2, 7)}`;
  const task = {
    id,
    title: 't',
    prompt: 'p',
    mode: 'agent',
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspaceId: 'ws-ghost-sweep',
    activity: [],
    filesChanged: [],
    steps: [],
    ...overrides,
  };
  const dir = path.join(home, 'history');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({ task, messages: [], savedAt: Date.now() }),
    'utf8',
  );
  return id;
}

async function readTask(id: string): Promise<{ status: string; error?: string }> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(home, 'history', `${id}.json`), 'utf8'),
  ) as { task: { status: string; error?: string } };
  return raw.task;
}

test('every non-terminal persisted status is rewritten as failed', async () => {
  const running = writeTaskFile({});
  const planning = writeTaskFile({ status: 'planning' });
  const queued = writeTaskFile({ status: 'queued' });
  const awaiting = writeTaskFile({ status: 'awaiting_permission' });
  const paused = writeTaskFile({ status: 'paused' });

  const store = new HistoryStore(); // fresh instance = fresh boot
  const repaired = await store.failInterrupted();

  assert.ok(repaired >= 5, `expected >=5 repairs, got ${repaired}`);
  for (const id of [running, planning, queued, awaiting, paused]) {
    const t = await readTask(id);
    assert.equal(t.status, 'failed', `${id} must be failed on disk`);
    assert.match(t.error ?? '', /Interrupted by restart/);
  }
  // The restore surface sees the repaired rows too — no ghost anywhere.
  const listed = await store.list('ws-ghost-sweep', 100);
  for (const id of [running, planning, queued, awaiting, paused]) {
    const row = listed.find((p) => p.task.id === id);
    assert.ok(row, `${id} must appear in list()`);
    assert.equal(row.task.status, 'failed');
  }
});

test('terminal tasks are untouched and a second boot is a no-op', async () => {
  const done = writeTaskFile({ status: 'completed' });
  const alreadyFailed = writeTaskFile({ status: 'failed', error: 'boom' });
  const cancelled = writeTaskFile({ status: 'cancelled' });

  const store = new HistoryStore();
  await store.failInterrupted();

  assert.equal((await readTask(done)).status, 'completed');
  assert.equal((await readTask(cancelled)).status, 'cancelled');
  const kept = await readTask(alreadyFailed);
  assert.equal(kept.status, 'failed');
  assert.equal(kept.error, 'boom', 'pre-existing error must be preserved');

  // Idempotent: nothing left to repair on the next boot.
  const again = await store.failInterrupted();
  const leftovers = (await store.list('ws-ghost-sweep', 200)).filter(
    (p) => !['completed', 'failed', 'cancelled'].includes(p.task.status),
  );
  assert.equal(leftovers.length, 0);
  assert.equal(again, 0, `second sweep must repair nothing, got ${again}`);
});

test('a corrupt history file does not break the sweep', async () => {
  const dir = path.join(home, 'history');
  fs.writeFileSync(path.join(dir, `corrupt-junk.json`), '{not json', 'utf8');
  const live = writeTaskFile({ status: 'verifying' });

  const store = new HistoryStore();
  const repaired = await store.failInterrupted(); // must not throw
  assert.equal((await readTask(live)).status, 'failed');
  fs.rmSync(path.join(dir, 'corrupt-junk.json')); // keep other sweeps clean
  assert.ok(repaired >= 1);
});
