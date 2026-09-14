import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

import { WorkspaceManager } from './workspace.js';
import { pickFolder } from './folderPicker.js';
import { OmniClient } from './omni.js';
import { detectMockGateway, enforceMockGuard, type MockGuardVerdict } from './mockGuard.js';
import { TerminalManager } from './terminal.js';
import { GitManager, buildFileDiff } from './git.js';
import { PermissionManager } from './permissions.js';
import { SkillManager } from './skills.js';
import { ProjectIndexer } from './indexer.js';
import { ContextManager } from './context.js';
import { CheckpointManager } from './checkpoints.js';
import { MemoryManager } from './memory.js';
import { HistoryStore } from './history.js';
import { HealthMonitor } from './healthCheck.js';
import { ToolRegistry } from './tools.js';
import { AgentEngine } from './agent.js';
import { PreviewManager } from './preview.js';
import { SettingsStore } from './settings.js';
import { DATA_DIR } from './dataDir.js';
import { PORT, HOST, OMNI_PORT, OMNI_DEFAULT_BASE_URL, LOOPBACK_HOST } from './config.js';
import { bus, emitFsChange } from './bus.js';
import { initDb, isDbReady } from './db.js';
import * as store from './dbStore.js';
import { dbRows } from './db.js';
import { maskKey, resolveApiKey } from './omni.js';
import { pickModelForTask, CATEGORY_PREFERENCES } from './router.js';
import { countTokens } from './tokens.js';
import type { ChangeProposal, ChatMessage, FileDiff, ModelInfo } from '../shared/types.js';

const settings = new SettingsStore();
const workspaces = new WorkspaceManager();
workspaces.ensureDirs();
const omni = new OmniClient(settings.settings.omni);
const terms = new TerminalManager();
const gitm = new GitManager();
const perms = new PermissionManager();
perms.autonomy = settings.settings.agent.autonomy;
const skills = new SkillManager(workspaces.skillsDir());
const indexer = new ProjectIndexer(workspaces);
const ctx = new ContextManager();
const cps = new CheckpointManager(DATA_DIR);
const memory = new MemoryManager();
const history = new HistoryStore();
const health = new HealthMonitor(omni, () => settings.settings.omni);
health.start();
const tools = new ToolRegistry(workspaces, perms, gitm, terms, cps, indexer, memory);
const agent = new AgentEngine(
  omni,
  tools,
  skills,
  ctx,
  indexer,
  workspaces,
  terms,
  memory,
  history,
);
agent.health = health;

// Restore persisted task history so the panel survives restarts & refreshes.
void history.list(undefined, 50).then((persisted) => {
  for (const p of persisted) agent.restorePersisted(p);
  if (persisted.length) console.log(`Restored ${persisted.length} persisted task(s) from history`);
});
// Re-open previously registered workspaces (registry persisted to ~/.aether/workspaces.json).
void workspaces.restoreRegistry().then((count) => {
  if (count > 0) console.log(`Restored ${count} workspace(s) from registry`);
});
const preview = new PreviewManager();

await skills.seedBuiltins();

// Seed the bundled skill pack (Aether-Skill-Pack/, 75 skills) — idempotent,
// user edits survive re-imports, imported skills start disabled.
try {
  const packRoot = join(process.cwd(), 'Aether-Skill-Pack');
  if (fs.existsSync(join(packRoot, 'skills-manifest.json'))) {
    const r = await skills.importPack(packRoot);
    if (r.imported > 0)
      console.log(
        `[skills] imported ${r.imported} skill-pack skills (${r.skipped} already present)`,
      );
  }
} catch (e) {
  console.warn('[skills] skill-pack import skipped:', e instanceof Error ? e.message : e);
}

// ---------- Database (PostgreSQL) ----------
// Brings up the pool, checks the connection, applies idempotent migrations.
// Never throws — if the DB is down the app runs with DB features disabled.
await initDb();

// ---------- OmniRoute health check ----------
// Pings /v1/models at startup to confirm reachability + auth. Missing API key
// is reported clearly (never logged in full). Non-fatal: the app runs and the
// UI degrades until the gateway answers.
let mockGuardVerdict: MockGuardVerdict | null = null;
let mockGuardActive = false;
{
  const key = omni.settings.apiKey || resolveApiKey();
  if (!key) {
    console.error(
      '[omni] OMNIROUTE_API_KEY is not set — requests will be unauthenticated. Set it in the environment or Settings.',
    );
  } else {
    console.log(`[omni] auth key loaded (${maskKey(key)})`);
  }
  try {
    const models = await omni.listModels();
    const selectable = omni.selectableModels.length;
    console.log(
      `[omni] gateway OK — ${models.length} model(s) in catalog, ${selectable} selectable (aliases + free)`,
    );
    if (!models.length)
      console.error(
        '[omni] gateway returned an EMPTY model catalog — AI features will be limited until it responds with models.',
      );
    // Mock-gateway guard: a stray mock process squatting on the gateway port
    // once silently replaced the real router for every task. Make it loud.
    mockGuardVerdict = enforceMockGuard(detectMockGateway(models), omni.settings.baseUrl);
    if (mockGuardVerdict.isMock) mockGuardActive = true;
  } catch (err) {
    console.error(
      `[omni] gateway UNREACHABLE at ${omni.settings.baseUrl}: ${err instanceof Error ? err.message : String(err)} — AI features are disabled until reconnected.`,
    );
  }
}

// ---------- REST API ----------
const app = express();
app.use(express.json({ limit: '30mb' }));
const upload = multer({ storage: multer.memoryStorage() });

const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

// --- OmniRoute ---
// `/omni/status` serves the full live OmniRoute model catalog. It's called
// by the frontend Settings loader and the `Test connection / refresh models`
// action, and also caches the catalog on the client so a fresh server boot
// picks up whatever the gateway currently exposes rather than a stale pick.
api.get('/omni/status', async (_req, res) => {
  refreshModels();
  try {
    const models = await omni.listModels();
    res.json({ connected: true, models, baseUrl: settings.settings.omni.baseUrl });
  } catch (err) {
    res.json({
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      baseUrl: settings.settings.omni.baseUrl,
    });
  }
});
async function refreshModels() {
  try {
    await omni.listModels(); // caches the catalog on omni._modelCatalog for fallback selection
  } catch {
    /* live catalog unavailable; the cached catalog keeps whatever was
      last known, so the fallback path degrades to a stale-but-concrete model
      rather than abandoning runs entirely. */
  }
}

api.get('/settings', (_req, res) => res.json(settings.settings));
api.put('/settings', (req, res) => {
  settings.settings = {
    omni: { ...settings.settings.omni, ...req.body.omni },
    ui: { ...settings.settings.ui, ...req.body.ui },
    agent: { autonomy: { ...settings.settings.agent.autonomy, ...req.body.agent?.autonomy } },
  };
  omni.settings = settings.settings.omni;
  perms.autonomy = settings.settings.agent.autonomy;
  settings.save();
  res.json(settings.settings);
});

// --- Workspaces ---
api.post('/workspaces', async (req, res) => {
  try {
    const { root, name } = req.body as { root: string; name?: string };
    const ws = await workspaces.addWorkspace(root, name);
    // Mirror into the projects table (fire-and-forget; DB optional)
    void store.upsertProject(ws.name, ws.root).catch(() => {});
    res.json(ws);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

api.get('/workspaces', (_req, res) => res.json(workspaces.list()));

api.delete('/workspaces/:id', (req, res) => {
  workspaces.removeWorkspace(req.params.id);
  res.json({ ok: true });
});

// --- Native folder/file picker (backend runs on the user's machine) ---
api.post('/pick-folder', async (req, res) => {
  const { startDir, marker, mode } = (req.body ?? {}) as {
    startDir?: string;
    marker?: string;
    mode?: 'folder' | 'file';
  };
  try {
    const picked = await pickFolder(startDir, marker, mode === 'file' ? 'file' : 'folder');
    // File mode: pick within the workspace root and return a workspace-relative path.
    if (mode === 'file' && picked) {
      const wid = String((req.body as { workspaceId?: string }).workspaceId ?? '');
      try {
        const ws = workspaces.require(wid);
        const rel = path.relative(ws.root, picked);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          res.json({ dir: null, file: rel.split(path.sep).join('/') });
          return;
        }
      } catch {
        /* unknown workspace — fall through to absolute */
      }
      res.json({ dir: null, file: picked });
      return;
    }
    res.json({ dir: picked });
  } catch (err) {
    res.json({ dir: null, error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Files ---
api.get('/workspaces/:id/tree', async (req, res) => {
  try {
    res.json(await workspaces.tree(req.params.id));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.get('/workspaces/:id/file', async (req, res) => {
  try {
    const p = String(req.query.path);
    const content = await workspaces.readFile(req.params.id, p);
    res.json({ path: p, content });
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

api.put('/workspaces/:id/file', async (req, res) => {
  try {
    const { path: p, content } = req.body as { path: string; content: string };
    await workspaces.writeFile(req.params.id, p, content);
    indexer.onFileChanged(p);
    // Mirror the file into the files table (fire-and-forget; DB optional)
    const wsRoot = workspaces.require(req.params.id).root;
    void (async () => {
      const pid = await store.getProjectId(wsRoot);
      await store.upsertFile(pid, p, content);
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.post('/workspaces/:id/file', async (req, res) => {
  try {
    const { path: p, content = '' } = req.body as { path: string; content?: string };
    await workspaces.writeFile(req.params.id, p, content);
    indexer.onFileChanged(p);
    const wsRoot = workspaces.require(req.params.id).root;
    void (async () => {
      const pid = await store.getProjectId(wsRoot);
      await store.upsertFile(pid, p, content);
    })().catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.delete('/workspaces/:id/file', async (req, res) => {
  try {
    const p = String(req.query.path);
    await workspaces.deleteFile(req.params.id, p);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.post('/workspaces/:id/rename', async (req, res) => {
  try {
    const { from, to } = req.body as { from: string; to: string };
    await workspaces.rename(req.params.id, from, to);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.post('/workspaces/:id/search', async (req, res) => {
  const { query } = req.body as { query: string };
  res.json({ files: indexer.fuzzySearch(query), symbols: indexer.searchSymbols(query) });
});

api.post('/workspaces/:id/index', async (req, res) => {
  const n = await indexer.index(
    req.params.id,
    Boolean((req.body as { incremental?: boolean } | undefined)?.incremental),
  );
  const st = indexer.stats();
  res.json({ indexed: n, ...st });
});

api.get('/workspaces/:id/map', (_req, res) =>
  res.json({ map: indexer.getCodebaseMap(), deps: indexer.dependencyGraph() }),
);

api.get('/workspaces/:id/symbols', (req, res) => {
  res.json({ symbols: indexer.searchSymbols(String(req.query.q ?? ''), 60) });
});

api.get('/workspaces/:id/usages', (req, res) => {
  res.json({ usages: indexer.findUsages(String(req.query.q ?? '')) });
});

// --- Git ---
api.get('/workspaces/:id/git/status', async (req, res) => {
  try {
    res.json({ isRepo: true, ...(await gitm.status(workspaces.require(req.params.id).root)) });
  } catch (e) {
    res.json({ files: [], branches: [], current: '', isRepo: false, error: String(e) });
  }
});

// Explicit repo probe: the UI needs a clean "no repository" signal, not a
// stack trace — empty workspaces get an "Initialize repository" action.
api.get('/workspaces/:id/git/repo', async (req, res) => {
  try {
    const root = workspaces.require(req.params.id).root;
    const current = await import('isomorphic-git').then((g) => g.currentBranch({ fs, dir: root }));
    res.json({ isRepo: current !== undefined, current: current ?? '' });
  } catch {
    res.json({ isRepo: false, current: '' });
  }
});

api.post('/workspaces/:id/git/init', async (req, res) => {
  try {
    await gitm.init(workspaces.require(req.params.id).root);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.get('/workspaces/:id/git/diff', async (req, res) => {
  try {
    const root = workspaces.require(req.params.id).root;
    const p = String(req.query.path ?? '');
    res.json(await gitm.diff(root, p));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Aggregate "review pending changes" payload: every working-tree change vs
// HEAD with its unified diff in one round trip. Files with no textual diff
// (binary, huge) still appear with an empty hunks list, so the file list is
// always complete even when some diffs can't be rendered.
api.get('/workspaces/:id/git/review', async (req, res) => {
  try {
    const root = workspaces.require(req.params.id).root;
    const status = await gitm.status(root);
    const files = await Promise.all(
      status.files.map(async (f) => {
        try {
          const d = await gitm.diff(root, f.path);
          return {
            path: f.path,
            status: f.status,
            additions: d.additions,
            deletions: d.deletions,
            hunks: d.hunks,
          };
        } catch {
          return { path: f.path, status: f.status, additions: 0, deletions: 0, hunks: [] };
        }
      }),
    );
    res.json({ current: status.current, files });
  } catch (e) {
    // Not a repo (or git failed): empty review, not an error — the UI shows
    // the editor-buffer fallback in that case.
    res.json({ current: '', files: [], error: String(e) });
  }
});

api.get('/workspaces/:id/git/log', async (req, res) => {
  try {
    res.json({ commits: await gitm.log(workspaces.require(req.params.id).root) });
  } catch (e) {
    res.json({ commits: [], error: String(e) });
  }
});

api.post('/workspaces/:id/git/commit', async (req, res) => {
  try {
    const root = workspaces.require(req.params.id).root;
    const { message, files } = req.body as { message: string; files?: string[] };
    if (files?.length) await gitm.addAll(root, files);
    else {
      const s = await gitm.status(root);
      await gitm.addAll(
        root,
        s.files.map((f) => f.path),
      );
    }
    const sha = await gitm.commit(root, message);
    res.json({ sha });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.post('/workspaces/:id/git/branch', async (req, res) => {
  try {
    const { name, checkout = true } = req.body as { name: string; checkout?: boolean };
    await gitm.branch(workspaces.require(req.params.id).root, name, checkout);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

api.post('/workspaces/:id/git/checkout', async (req, res) => {
  try {
    await gitm.checkout(
      workspaces.require(req.params.id).root,
      String((req.body as { ref: string }).ref),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// --- Agent ---
api.post('/agent/tasks', async (req, res) => {
  const t = await agent.enqueue(req.body);
  res.json(t);
});

// --- Memory ---
api.get('/workspaces/:id/memory', async (req, res) => {
  try {
    res.json(await memory.list(req.params.id));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
api.post('/workspaces/:id/memory', async (req, res) => {
  try {
    const { text } = req.body as { text: string };
    const entry = await memory.add(req.params.id, String(text ?? ''), 'user');
    bus.emit('memory', { workspaceId: req.params.id });
    res.json(entry);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
api.delete('/workspaces/:id/memory/:entryId', async (req, res) => {
  const ok = await memory.remove(req.params.id, req.params.entryId);
  bus.emit('memory', { workspaceId: req.params.id });
  res.json({ ok });
});
api.post('/workspaces/:id/memory/clear', async (req, res) => {
  await memory.clear(req.params.id);
  bus.emit('memory', { workspaceId: req.params.id });
  res.json({ ok: true });
});

api.get('/agent/tasks', (req, res) =>
  res.json(agent.listTasks(req.query.workspaceId as string | undefined)),
);
api.get('/agent/tasks/:id', (req, res) => res.json(agent.getTask(req.params.id) ?? null));
api.get('/agent/tasks/:id/messages', (req, res) => res.json(agent.getMessages(req.params.id)));
api.get('/agent/tasks/:id/stream-state', (req, res) => res.json(agent.streamState(req.params.id)));

api.post('/agent/tasks/:id/pause', (req, res) => {
  agent.pause(req.params.id);
  res.json({ ok: true });
});
api.post('/agent/tasks/:id/resume', (req, res) => {
  agent.resume(req.params.id);
  res.json({ ok: true });
});
api.post('/agent/tasks/:id/cancel', (req, res) => {
  agent.cancel(req.params.id);
  res.json({ ok: true });
});
api.post('/agent/tasks/:id/retry', (req, res) =>
  res.json(agent.retry(req.params.id, (req.body as { prompt?: string }).prompt) ?? null),
);

// Plan artifact lifecycle: approve → spawns the Agent-mode implementation
// task; reject → task cancelled; comment → plan regenerated with feedback.
api.post('/agent/tasks/:id/plan/approve', async (req, res) => {
  const t = agent.getTask(req.params.id);
  if (!t?.plan) return res.status(404).json({ error: 'no plan for this task' });
  const impl = await agent.approvePlanAndExecute(
    req.params.id,
    (req.body as { model?: string }).model,
  );
  res.json({ ok: true, implementationTask: impl });
});
api.post('/agent/tasks/:id/plan/reject', (req, res) => {
  const ok = agent.approvePlan(req.params.id, false);
  res.json({ ok });
});
api.post('/agent/tasks/:id/plan/comment', async (req, res) => {
  const { comments } = req.body as { comments: { line: number; text: string }[] };
  const ok = await agent.revisePlan(req.params.id, Array.isArray(comments) ? comments : []);
  res.json({ ok });
});

api.post('/agent/questions/:id/answer', (req, res) => {
  const ok = agent.answerQuestion(req.params.id, String((req.body as { answer: string }).answer));
  res.json({ ok });
});

// --- Chat ---
api.post('/chat', async (req, res) => {
  const { messages, model, system, skillsEnabled, workspaceId, skillId } = req.body as {
    messages: { role: string; content: string }[];
    model?: string;
    system?: string;
    skillsEnabled?: boolean;
    workspaceId?: string;
    skillId?: string;
  };
  // Skills active for this chat: the workspace-scoped enabled set, plus any
  // skill explicitly invoked with `/skill-id` in the composer.
  let enabled = skillsEnabled
    ? workspaceId
      ? await skills.enabledFor(workspaceId)
      : (await skills.loadAll()).filter((s) => s.enabled)
    : [];
  if (skillId) {
    const all = await skills.loadAll();
    const invoked = all.find((s) => s.id === skillId);
    if (invoked && !enabled.some((s) => s.id === invoked.id)) enabled = [...enabled, invoked];
  }
  const skillFragment = enabled.length ? skills.composeSystemFragment(enabled) : '';
  const sys =
    (system ??
      'You are Aether, an AI coding assistant inside a professional IDE. Answer concisely with markdown and code blocks.') +
    (skillFragment ? `\n\n${skillFragment}` : '');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const chatModel =
    model ||
    settings.settings.omni.modelPrefs.chat ||
    settings.settings.omni.modelPrefs.coding ||
    settings.settings.omni.fallbackModel ||
    omni._modelCatalog[0]?.id ||
    '';
  if (!chatModel) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(
      `data: ${JSON.stringify({ type: 'error', error: 'No model available — check the OmniRoute endpoint in Settings, or pick a model in the composer.' })}\n\n`,
    );
    res.end();
    return;
  }
  try {
    const result = await omni.chatStream(
      { model: chatModel, messages: [{ role: 'system', content: sys }, ...messages] },
      {
        onDelta: (d) => send({ type: 'delta', delta: d }),
        onUsage: (u) => {
          if (u) {
            settings.recordUsage(u.model, u.inputTokens, u.outputTokens);
            bus.emit('usage', {
              model: u.model,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              kind: 'chat',
              ts: Date.now(),
            });
          }
        },
      },
    );
    if (result.resolvedModel && result.resolvedModel !== chatModel) {
      send({ type: 'model', model: result.resolvedModel });
    }
    send({ type: 'done', text: result.text });
  } catch (err) {
    settings.recordError();
    send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
  res.end();
});

// --- Skills (workspace-scoped) ---
// `?workspaceId=` scopes enable/disable state to the project folder. The
// Skill object's `enabled` flag stays as the *global* default; the effective
// per-project view is computed on top. Skills marked disabled globally are
// not callable in chat regardless of project overrides.
api.get('/skills', async (req, res) => {
  const all = await skills.loadAll();
  const wsId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!wsId) return res.json(all);
  const enabledIds = new Set((await skills.enabledFor(wsId)).map((s) => s.id));
  res.json(all.map((s) => ({ ...s, enabled: enabledIds.has(s.id) })));
});
api.post('/skills', async (req, res) =>
  res.json(await skills.save(req.body as Parameters<typeof skills.save>[0])),
);
api.put('/skills/:id', async (req, res) =>
  res.json(
    await skills.save({
      ...(req.body as Partial<Parameters<typeof skills.save>[0]>),
      id: req.params.id,
    } as Parameters<typeof skills.save>[0]),
  ),
);
api.delete('/skills/:id', async (req, res) => {
  await skills.remove(req.params.id);
  res.json({ ok: true });
});
api.post('/skills/:id/toggle', async (req, res) => {
  const wsId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const all = await skills.loadAll();
  const s = all.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'no such skill' });
  // Effective current state for this scope, then flip it.
  const effective = wsId ? (await skills.enabledFor(wsId)).some((x) => x.id === s.id) : s.enabled;
  await skills.setEnabledFor(s.id, !effective, wsId ?? null);
  // Respond with the refreshed per-scope view.
  const refreshed = wsId ? (await skills.enabledFor(wsId)).some((x) => x.id === s.id) : !s.enabled;
  res.json({ ...s, enabled: refreshed });
});
api.post('/skills/import', async (req, res) => {
  try {
    const s = await skills.save(req.body);
    res.json(s);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Bulk-import the bundled skill pack (or overwrite existing pack skills).
api.post('/skills/import-pack', async (req, res) => {
  try {
    const overwrite = Boolean((req.body as { overwrite?: boolean } | undefined)?.overwrite);
    const packRoot = join(process.cwd(), 'Aether-Skill-Pack');
    if (!fs.existsSync(join(packRoot, 'skills-manifest.json'))) {
      return res.status(404).json({ error: 'Aether-Skill-Pack/skills-manifest.json not found' });
    }
    res.json(await skills.importPack(packRoot, overwrite));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// --- Skill pack (Aether-Skill-Pack): manifest + raw skill markdown ---
const SKILL_PACK_ROOT = join(process.cwd(), 'Aether-Skill-Pack');
api.get('/skills-pack/manifest', async (_req, res) => {
  try {
    const raw = await fsp.readFile(join(SKILL_PACK_ROOT, 'skills-manifest.json'), 'utf8');
    res.type('json').send(raw);
  } catch {
    res
      .status(404)
      .json({
        error: 'skills-manifest.json not found — run: node scripts/generate-skills-manifest.mjs',
      });
  }
});
api.get('/skills-pack/file', async (req, res) => {
  const rel = String(req.query.path ?? '');
  // Path-traversal guard: only files inside the pack, .md only.
  const abs = join(SKILL_PACK_ROOT, rel);
  if (!abs.startsWith(SKILL_PACK_ROOT) || !rel.endsWith('.md')) {
    return res.status(400).json({ error: 'invalid skill path' });
  }
  try {
    const content = await fsp.readFile(abs, 'utf8');
    res.json({ path: rel, content });
  } catch {
    res.status(404).json({ error: `skill file not found: ${rel}` });
  }
});

// --- Permissions ---
api.get('/permissions/rules', (_req, res) => res.json(perms.listRules()));
api.get('/permissions/pending', (_req, res) => res.json(perms.pendingList()));
api.delete('/permissions/rules/:id', (req, res) => {
  perms.removeRule(req.params.id);
  res.json({ ok: true });
});
api.post('/permissions/decide', (req, res) => {
  const { id, decision } = req.body as { id: string; decision: 'allow' | 'always' | 'deny' };
  res.json({ ok: perms.decide(id, decision) });
});

// --- Checkpoints ---
api.get('/workspaces/:id/checkpoints', async (req, res) => res.json(await cps.list(req.params.id)));
api.post('/workspaces/:id/checkpoints', async (req, res) => {
  const cp = await tools.createCheckpointFor(
    req.params.id,
    'manual',
    String((req.body as { label?: string }).label ?? 'Manual checkpoint'),
  );
  res.json(cp);
});
api.post('/workspaces/:id/checkpoints/:cpId/restore', async (req, res) => {
  try {
    const r = await cps.restore(req.params.id, req.params.cpId, {
      currentFiles: () => workspaces.listFiles(req.params.id),
      readFile: (p) => workspaces.readFile(req.params.id, p),
      writeFile: (p, c) => workspaces.writeFile(req.params.id, p, c),
      deleteFile: (p) => workspaces.deleteFile(req.params.id, p),
    });
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// --- Proposals (accept/reject) ---
api.get('/proposals', (_req, res) => res.json([...tools.proposals.values()]));
api.post('/proposals/:id/accept', (req, res) =>
  res.json({ ok: tools.acceptProposal(req.params.id) }),
);
api.post('/proposals/:id/reject', (req, res) =>
  res.json({ ok: tools.rejectProposal(req.params.id) }),
);

// --- Terminal ---
api.post('/terminals', (req, res) => {
  const { cwd } = req.body as { cwd?: string };
  const s = terms.create(cwd ?? os.homedir());
  res.json({ id: s.id, title: s.title, cwd: s.cwd });
});

// Dynamic terminal suggestions: commands that actually make sense for THIS
// project (package.json scripts, plus framework-aware defaults). The panel
// renders these as one-click "run in a new terminal" chips.
api.get('/workspaces/:id/terminal-suggestions', async (req, res) => {
  const root = workspaces.require(req.params.id).root;
  const exists = (p: string) => {
    try {
      return fs.existsSync(path.join(root, p));
    } catch {
      return false;
    }
  };
  const suggestions: { command: string; label: string }[] = [];
  const push = (command: string, label?: string) => {
    if (command && !suggestions.some((s) => s.command === command) && suggestions.length < 6) {
      suggestions.push({ command, label: label ?? command });
    }
  };
  try {
    if (exists('package.json')) {
      const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      const runner = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : 'npm run';
      const priority = ['dev', 'start', 'build', 'test', 'lint', 'typecheck', 'preview'];
      for (const name of priority)
        if (scripts[name])
          push(
            `${runner === 'npm run' ? (name === 'dev' || name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`) : `${runner} ${name}`}`,
          );
      for (const name of Object.keys(scripts)) {
        if (priority.includes(name)) continue;
        push(`${runner} ${name}`);
      }
      if (!scripts.dev && !scripts.start) push('node index.js');
    } else if (exists('requirements.txt') || exists('pyproject.toml')) {
      push('python -m venv .venv', 'python -m venv .venv');
      push('pip install -r requirements.txt', 'pip install -r requirements.txt');
      push('python main.py', 'python main.py');
    } else if (exists('go.mod')) {
      push('go run .');
      push('go test ./...');
    } else if (exists('Cargo.toml')) {
      push('cargo run');
      push('cargo test');
    } else {
      push('ls');
    }
    if (exists('.git')) push('git status');
    else push('git init', 'git init — start version control here');
  } catch {
    /* suggestion enumeration is best-effort */
  }
  res.json({ suggestions });
});
api.get('/terminals', (_req, res) =>
  res.json([...terms.sessions.values()].map(({ id, title, cwd }) => ({ id, title, cwd }))),
);
api.delete('/terminals/:id', (req, res) => {
  terms.kill(req.params.id);
  res.json({ ok: true });
});

// --- Preview ---
api.post('/preview/start', async (req, res) => {
  try {
    const { workspaceId } = req.body as { workspaceId: string };
    const ws = workspaces.require(workspaceId);
    const port = await preview.startFor(ws.root);
    res.json({ url: preview.url, port });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
api.post('/preview/stop', (_req, res) => {
  preview.stop();
  res.json({ ok: true });
});

// --- Context ---
api.get('/context', (_req, res) => res.json(ctx.report(indexer)));
api.post('/context/pin', (req, res) => {
  ctx.pin(String((req.body as { path: string }).path));
  res.json(ctx.report(indexer));
});
api.post('/context/unpin', (req, res) => {
  ctx.unpin(String((req.body as { path: string }).path));
  res.json(ctx.report(indexer));
});
api.post('/context/include', async (req, res) => {
  const { workspaceId, path: p } = req.body as { workspaceId: string; path: string };
  try {
    ctx.includeFile(p, await workspaces.readFile(workspaceId, p));
  } catch {
    /* gone */
  }
  res.json(ctx.report(indexer));
});
api.post('/context/exclude', (req, res) => {
  ctx.excludeFile(String((req.body as { path: string }).path));
  res.json(ctx.report(indexer));
});
api.post('/context/reset', (_req, res) => {
  ctx.reset();
  res.json(ctx.report(indexer));
});

// --- Analytics ---
api.get('/analytics', (_req, res) => res.json(settings.analytics));

// --- Database read layer (history, usage, timeline) ---
api.get('/db/status', (_req, res) => res.json({ ready: isDbReady() }));

// --- Multi-model routing (manual picker data + auto-routing transparency) ---
// Selectable models for the UI picker: routing aliases + inferred-free,
// chat-capable models, with flag metadata for grouping.
api.get('/models/selectable', (_req, res) => {
  res.json({
    connected: omni.selectableModels.length > 0 || omni._modelCatalog.length > 0,
    models: omni.selectableModels,
  });
});

// --- Runtime configuration (single source of truth: server/config.ts) ---
// Surfaces the resolved defaults so UI copy and probes never re-declare them.
api.get('/config/runtime', (_req, res) =>
  res.json({
    port: PORT,
    host: HOST,
    omniPort: OMNI_PORT,
    omniDefaultBaseUrl: OMNI_DEFAULT_BASE_URL,
  }),
);

// --- Model health (background probe results) ---
api.get('/health/models', (_req, res) => res.json(health.snapshot()));
// Mock-gateway guard verdict from the startup check (null until the first
// catalog fetch succeeds). Surfaces in dev tools / UI so a squatting mock is
// diagnosable without reading server logs.
api.get('/health/gateway-guard', (_req, res) =>
  res.json({ active: mockGuardActive, verdict: mockGuardVerdict }),
);
api.post('/health/models/refresh', async (_req, res) => {
  res.json(await health.probeAll(true)); // on-demand probe (Settings "Test connection" etc.)
});

// Full catalog for the "show all models" picker toggle: every chat-capable
// entry grouped by provider, with free/paid badges. "Working" marks providers
// backed by the user's own configured keys (data-driven: provider prefixes of
// models that succeeded in model_usage history, plus key-backed openrouter).
api.get('/models/all', async (_req, res) => {
  const workingProviders = new Set(['openrouter']);
  try {
    const rows = await dbRows<{ model_name: string }>(
      'SELECT DISTINCT model_name FROM model_usage',
    );
    for (const r of rows) {
      const prefix = r.model_name.split('/')[0];
      if (prefix && prefix !== 'auto') workingProviders.add(prefix);
    } // successful history marks a provider as alive
  } catch {
    /* DB off — key-backed default still applies */
  }
  const models = omni._modelCatalog.map((m) => ({
    id: m.id,
    owned_by: m.owned_by,
    free: m.free,
    routingAlias: m.routingAlias,
    provider: m.routingAlias ? 'routing aliases' : m.id.split('/')[0] || 'other',
    working: m.routingAlias || workingProviders.has(m.id.split('/')[0] || ''),
  }));
  res.json({ models });
});

// Explain the routing preferences per task category (for the UI and tuning).
api.get('/routing/preferences', (_req, res) => res.json(CATEGORY_PREFERENCES));

// Dev-mode: run the auto-routing classifier on a sample task to see which
// model would be chosen and why. Body: { prompt, mode?, files?, hasImage? }
api.post('/routing/explain', (req, res) => {
  const { prompt, mode, files, hasImage } = req.body as {
    prompt: string;
    mode?: 'agent' | 'ask' | 'plan';
    files?: string[];
    hasImage?: boolean;
  };
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  const selectable = omni.selectableModels.length ? omni.selectableModels : omni._modelCatalog;
  res.json(pickModelForTask({ prompt, mode, files, hasImage }, selectable));
});

api.get('/db/projects', async (_req, res) => res.json(await store.getProjectHistory()));

api.get('/db/projects/:id/files', async (req, res) =>
  res.json(await store.getFileHistory(Number(req.params.id))),
);

api.get('/db/projects/:id/sessions', async (req, res) =>
  res.json(await store.getSessions(Number(req.params.id))),
);

api.get('/db/sessions/:id/actions', async (req, res) =>
  res.json(await store.getAgentActions(Number(req.params.id))),
);

api.get('/db/projects/:id/usage', async (req, res) => {
  const [bySession, byModel] = await Promise.all([
    store.getUsageBySession(Number(req.params.id)),
    store.getUsageByModel(Number(req.params.id)),
  ]);
  res.json({ bySession, byModel });
});

api.get('/db/usage', async (_req, res) => res.json(await store.getUsageByModel()));

api.get('/db/projects/:id/timeline', async (req, res) =>
  res.json(await store.getCommitTimeline(Number(req.params.id))),
); // --- Uploads (attachments saved into .aether-uploads in workspace) ---
api.post('/workspaces/:id/upload', upload.array('files'), async (req, res) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    const out: string[] = [];
    for (const f of files) {
      const dest = `.aether-uploads/${Date.now()}-${f.originalname.replace(/[^\w.-]/g, '_')}`;
      await workspaces.writeFile(req.params.id, dest, f.buffer.toString('utf8'));
      out.push(dest);
    }
    res.json({ paths: out });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.use('/api', api);

// ---------- Icon assets ----------
// Static SVG set (checked into public/, copied into dist at build) plus a
// lazy directory listing so the frontend can discover icons that were added
// to the folder after the app was built — custom icons, updated icon packs —
// without shipping a bundled manifest.
const ICONS_DIR = path.join(process.cwd(), 'public', 'icons', 'vscode');
let iconListCache: { names: string[]; at: number } | null = null;

api.get('/icons/list', async (_req, res) => {
  try {
    // Short TTL cache: re-reads pick up newly dropped SVGs without a
    // restart, while repeated tree renders never re-scan the directory.
    if (!iconListCache || Date.now() - iconListCache.at > 30_000) {
      const names = (await fsp.readdir(ICONS_DIR)).filter((n) => n.endsWith('.svg')).sort();
      iconListCache = { names, at: Date.now() };
    }
    res.json({ icons: iconListCache.names });
  } catch {
    res.json({ icons: [] });
  }
});

// Serve the SVGs themselves from public/ so dev (Vite) and prod (Express)
// both resolve /icons/vscode/*.svg without a build step.
app.use('/icons', express.static(ICONS_DIR));

app.use(express.static(path.join(process.cwd(), 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(process.cwd(), 'dist', 'index.html')));

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
// Bind errors are managed centrally in bindServer() below. Without this
// handler, ws re-emits the server's EADDRINUSE as an unhandled 'error' event
// and crashes the process before the fallback-port retry can run.
wss.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') return; // handled by bindServer
  console.error('[ws] server error:', err);
});

function broadcast(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload });
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

bus.on('activity', (a) => broadcast('activity', a));
bus.on('task', (t) => broadcast('task', t));
bus.on('permission', (p) => broadcast('permission', p));
bus.on('question', (q) => broadcast('question', q));
bus.on('proposal', (p) => broadcast('proposal', p));
bus.on('usage', (u) => broadcast('usage', u));
bus.on('fs:change', (ev) => {
  broadcast('fs:change', ev);
  indexer.onFileChanged(ev.path).catch(() => {});
  preview.notifyChange();
});

// ---------- Git commit capture ----------
// The agent emits 'agent:commit' after any commit it creates (git_commit tool,
// checkpoint auto-commits). Persist commit metadata into git_commits, linked
// to the agent_action that caused it.
bus.on('agent:commit', (p: { workspaceId: string; commitHash: string; taskId?: string }) => {
  void (async () => {
    const ws = workspaces.get(p.workspaceId);
    if (!ws) return;
    const projectId = await store.getProjectId(ws.root);
    const actionId = p.taskId ? (agent.dbActions.get(p.taskId) ?? null) : null;
    await store.recordGitCommit({ projectId, actionId, root: ws.root, commitHash: p.commitHash });
  })().catch((e) =>
    console.error(`[db] git commit capture failed: ${e instanceof Error ? e.message : String(e)}`),
  );
});
bus.on('agent:delta', (d) => broadcast('agent:delta', d));
bus.on('agent:message', (m) => broadcast('agent:message', m));
bus.on('agent:status', (s) => broadcast('agent:status', s));
bus.on('memory', (m) => broadcast('memory', m));

wss.on('connection', (sock) => {
  // terminal data flows per-client
  const termHandlers = new Map<string, (d: string) => void>();
  sock.on('message', (raw) => {
    let msg: { type: string; payload: Record<string, unknown> };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'term:create') {
      const s = terms.create(String(msg.payload.cwd ?? os.homedir()));
      const handler = (d: string) =>
        sock.send(JSON.stringify({ type: 'term:data', payload: { id: s.id, data: d } }));
      const onCmd = (c: unknown) =>
        sock.send(JSON.stringify({ type: 'term:command', payload: { id: s.id, command: c } }));
      const onCwd = (cwd: string) => {
        s.currentCwd = cwd;
        s.title = `${cwd.split(/[\\/]/).pop() || cwd}`; // tab follows the cwd
        sock.send(JSON.stringify({ type: 'term:cwd', payload: { id: s.id, cwd, title: s.title } }));
      };
      s.emitter.on('data', handler);
      s.emitter.on('command-finished', onCmd);
      s.emitter.on('cwd', onCwd);
      termHandlers.set(s.id, handler);
      sock.send(
        JSON.stringify({
          type: 'term:created',
          payload: { id: s.id, title: s.title, cwd: s.cwd, integrated: s.integrated },
        }),
      );
    } else if (msg.type === 'term:input') {
      const { id, data } = msg.payload as { id: string; data: string };
      terms.sessions.get(id)?.write(data);
    } else if (msg.type === 'term:resize') {
      const { id, cols, rows } = msg.payload as { id: string; cols: number; rows: number };
      terms.sessions.get(id)?.resize(cols, rows);
    } else if (msg.type === 'term:kill') {
      const { id } = msg.payload as { id: string };
      terms.kill(id);
    }
  });
  sock.on('close', () => {
    for (const [id, h] of termHandlers) {
      terms.sessions.get(id)?.emitter.off('data', h);
    }
  });
});

// workspace watcher events -> bus
workspaces.on('fs:change', (ev) => emitFsChange(ev));

// --- Bind with fallback + co-bind detection (audit Section 2) ---
// The listen must never fail silently: EADDRINUSE falls forward to the next
// port, and — because Windows permits a second process to bind an occupied
// loopback port without raising EADDRINUSE — a successful listen() is verified
// by calling our own API. Anything but our JSON answering means another
// process owns the port and we refuse to co-bind.
const MAX_PORT_ATTEMPTS = 5;

function bindServer(attempt: number): void {
  const port = PORT + attempt;
  // On Windows one listen attempt can race: the socket layer co-binds
  // (callback fires) while ws surfaces EADDRINUSE. `settled` guarantees the
  // success / retry decision is made exactly once per attempt.
  let settled = false;
  const proceed = (fn: () => void): void => {
    if (!settled) {
      settled = true;
      server.off('error', onError);
      fn();
    }
  };
  const retry = (): void => {
    if (attempt + 1 < MAX_PORT_ATTEMPTS) {
      console.warn(`[server] trying ${port + 1}`);
      bindServer(attempt + 1);
    } else {
      console.error('[server] FATAL: no bindable port in range');
      process.exit(1);
    }
  };
  const onError = (err: NodeJS.ErrnoException): void => {
    proceed(() => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[server] port ${port} unavailable (EADDRINUSE)`);
        retry();
      } else {
        console.error(
          `[server] FATAL: could not bind ${HOST}:${port} — ${err.code ?? err.name}: ${err.message}`,
        );
        process.exit(1);
      }
    });
  };
  server.on('error', onError);
  server.listen(port, HOST, () => {
    const announce = (): void =>
      proceed(() => {
        const label = attempt === 0 ? '' : ` (fallback: ${PORT} was occupied)`;
        console.log(`Aether backend listening on http://${HOST}:${port}${label}`);
        console.log(`Model endpoint: ${settings.settings.omni.baseUrl}`);
      });
    const foreign = (detail: string): void =>
      proceed(() => {
        console.error(
          `[server] port ${port} is answering for another process (${detail}) — refusing to co-bind`,
        );
        server.closeAllConnections?.();
        server.close(() => retry());
      });
    const probe = (): Promise<'ours' | 'foreign' | 'no-answer'> =>
      fetch(`http://${LOOPBACK_HOST}:${port}/api/health/gateway-guard`, {
        signal: AbortSignal.timeout(2500),
      })
        .then((res) => (res.ok ? 'ours' : 'foreign')) // any non-ok status = someone else's server
        .catch((e: unknown) =>
          e instanceof Error && e.name === 'TimeoutError' ? 'no-answer' : 'no-answer',
        );
    void (async () => {
      let verdict = await probe();
      if (verdict === 'no-answer') {
        // Transient refusals happen against a freshly listening socket; one
        // delayed re-probe avoids migrating a healthy server off its port.
        await new Promise((r) => setTimeout(r, 500));
        verdict = await probe();
      }
      if (verdict === 'ours') announce();
      else if (verdict === 'foreign') foreign('HTTP response is not ours');
      else announce(); // nothing answering after two tries — accept our bind
    })();
  });
}
bindServer(0);
