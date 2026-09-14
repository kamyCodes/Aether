/**
 * Data-access layer over the SQLite db: typed row shapes plus all queries
 * for tasks, usage, and pricing snapshots. Only module that touches db.ts
 * directly besides index.ts bootstrap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { dbExec, dbRows, isDbReady, projectRoot } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Pricing ----------

type PricingEntry = { input: number; output: number };
const pricingFile = path.join(projectRoot(), 'config', 'pricing.json');
let pricing: Record<string, PricingEntry> = {};
try {
  pricing = (
    JSON.parse(fs.readFileSync(pricingFile, 'utf8')) as { models: Record<string, PricingEntry> }
  ).models;
} catch (err) {
  console.error(
    `[db] could not load config/pricing.json — costs will be 0: ${err instanceof Error ? err.message : String(err)}`,
  );
}

/** Longest-prefix match: 'gpt-4o' wins over 'gpt-4' for 'gpt-4o-mini'. */
export function priceFor(model: string): PricingEntry {
  let best: string | null = null;
  for (const key of Object.keys(pricing)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? pricing[best] : { input: 0, output: 0 };
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

// ---------- Projects ----------

export async function getProjectId(rootPath: string): Promise<number | null> {
  if (!isDbReady()) return null;
  const rows = await dbRows<{ id: number }>('SELECT id FROM projects WHERE root_path = $1', [
    rootPath,
  ]);
  return rows[0]?.id ?? null;
}

export async function upsertProject(name: string, rootPath: string, language?: string) {
  if (!isDbReady()) return null;
  const r = await dbExec(
    `INSERT INTO projects (name, root_path, language) VALUES ($1, $2, $3)
     ON CONFLICT (root_path) DO UPDATE SET name = EXCLUDED.name, language = EXCLUDED.language, updated_at = NOW()
     RETURNING id`,
    [name, rootPath, language ?? null],
  );
  return r?.rows[0]?.id ?? null;
}

// ---------- Files ----------

export async function upsertFile(
  projectId: number | null,
  relPath: string,
  content: string | null,
) {
  if (!isDbReady() || !projectId) return null;
  const r = await dbExec(
    `INSERT INTO files (project_id, path, content, last_modified) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (project_id, path) DO UPDATE SET content = EXCLUDED.content, last_modified = NOW()
     RETURNING id`,
    [projectId, relPath, content],
  );
  return r?.rows[0]?.id ?? null;
}

export async function getFileId(projectId: number, relPath: string): Promise<number | null> {
  if (!isDbReady()) return null;
  const rows = await dbRows<{ id: number }>(
    'SELECT id FROM files WHERE project_id = $1 AND path = $2',
    [projectId, relPath],
  );
  return rows[0]?.id ?? null;
}

// ---------- Sessions ----------

export async function startSession(projectId: number | null): Promise<number | null> {
  if (!isDbReady()) return null;
  const r = await dbExec('INSERT INTO sessions (project_id, status) VALUES ($1, $2) RETURNING id', [
    projectId,
    'active',
  ]);
  return r?.rows[0]?.id ?? null;
}

export async function endSession(
  sessionId: number | null,
  status: 'completed' | 'failed' | 'cancelled',
) {
  if (!isDbReady() || !sessionId) return;
  await dbExec(`UPDATE sessions SET ended_at = NOW(), status = $2 WHERE id = $1`, [
    sessionId,
    status,
  ]);
}

// ---------- Agent actions ----------

export type ActionInput = {
  sessionId: number | null;
  actionType: string; // edit | run | suggest | error_fix | commit | tool
  filePath?: string | null;
  projectId?: number | null;
  prompt?: string | null;
  result?: string | null;
};

export async function recordAgentAction(input: ActionInput): Promise<number | null> {
  if (!isDbReady()) return null;
  let fileId: number | null = null;
  if (input.filePath && input.projectId) {
    fileId = await getFileId(input.projectId, input.filePath);
  }
  const r = await dbExec(
    'INSERT INTO agent_actions (session_id, action_type, file_id, prompt, result) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [input.sessionId, input.actionType, fileId, input.prompt ?? null, input.result ?? null],
  );
  return r?.rows[0]?.id ?? null;
}

// ---------- Model usage ----------

export async function recordModelUsage(u: {
  sessionId: number | null;
  actionId: number | null;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
}) {
  if (!isDbReady()) return;
  const cost = estimateCost(u.modelName, u.inputTokens, u.outputTokens);
  await dbExec(
    `INSERT INTO model_usage (session_id, action_id, model_name, input_tokens, output_tokens, latency_ms, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.sessionId, u.actionId, u.modelName, u.inputTokens, u.outputTokens, u.latencyMs, cost],
  );
}

// ---------- Git commits ----------

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, maxBuffer: 1024 * 1024, timeout: 10_000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

/**
 * Capture commit metadata via `git log -1` + `git show --stat` and persist a
 * git_commits row linked back to the agent_action that caused the commit.
 * Idempotent per commit_hash.
 */
export async function recordGitCommit(opts: {
  projectId: number | null;
  actionId: number | null;
  root: string;
  commitHash: string;
}) {
  if (!isDbReady() || !opts.commitHash) return;
  const [log, stat] = await Promise.all([
    runGit(opts.root, ['log', '-1', '--format=%H%n%s%n%D', opts.commitHash]),
    runGit(opts.root, ['show', '--stat', '--format=', opts.commitHash]),
  ]);
  if (!log) return;
  const lines = log.split('\n').filter(Boolean);
  const message = lines[1] ?? '';
  const refLine = lines[2] ?? '';
  const branch =
    refLine
      .split(',')[0]
      .replace(/^HEAD -> /, '')
      .trim() || null;

  const statLines = stat.trim().split('\n');
  const summary = statLines[statLines.length - 1] ?? '';
  const m = summary.match(
    /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
  );
  await dbExec(
    `INSERT INTO git_commits (project_id, action_id, commit_hash, branch, message, diff_summary, files_changed, additions, deletions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (commit_hash) DO NOTHING`,
    [
      opts.projectId,
      opts.actionId,
      opts.commitHash,
      branch,
      message,
      summary,
      m ? Number(m[1]) : null,
      m?.[2] ? Number(m[2]) : null,
      m?.[3] ? Number(m[3]) : null,
    ],
  );
}

/**
 * Backfill: attach the most recent unlinked commit for a project to the
 * agent_action that caused it (the commit broadcast can fire inside the tool
 * before the action row exists).
 */
export async function linkLatestCommitToAction(projectId: number | null, actionId: number | null) {
  if (!isDbReady() || !projectId || !actionId) return;
  await dbExec(
    `UPDATE git_commits SET action_id = $2
     WHERE id = (SELECT id FROM git_commits WHERE project_id = $1 AND action_id IS NULL ORDER BY committed_at DESC LIMIT 1)`,
    [projectId, actionId],
  );
}

// ---------- Read layer ----------

export async function getProjectHistory(limit = 50) {
  return dbRows(
    `SELECT id, name, root_path, language, created_at, updated_at FROM projects ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
}

export async function getFileHistory(projectId: number, limit = 100) {
  return dbRows(
    `SELECT id, path, last_modified, LENGTH(content) AS content_bytes FROM files WHERE project_id = $1 ORDER BY last_modified DESC LIMIT $2`,
    [projectId, limit],
  );
}

export async function getAgentActions(sessionId: number, limit = 200) {
  return dbRows(
    `SELECT a.id, a.action_type, a.prompt, a.result, a.created_at, f.path AS file_path
     FROM agent_actions a LEFT JOIN files f ON f.id = a.file_id
     WHERE a.session_id = $1 ORDER BY a.created_at ASC LIMIT $2`,
    [sessionId, limit],
  );
}

export async function getSessions(projectId: number, limit = 50) {
  return dbRows(
    `SELECT id, started_at, ended_at, status,
            (SELECT COUNT(*) FROM agent_actions a WHERE a.session_id = s.id) AS action_count
     FROM sessions s WHERE project_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [projectId, limit],
  );
}

/** Totals per session (tokens, cost, latency) for the usage dashboard. */
export async function getUsageBySession(projectId: number) {
  return dbRows(
    `SELECT s.id AS session_id, s.started_at, s.status,
            COALESCE(SUM(mu.input_tokens), 0) AS input_tokens,
            COALESCE(SUM(mu.output_tokens), 0) AS output_tokens,
            COALESCE(SUM(mu.cost_usd), 0) AS cost_usd,
            COALESCE(AVG(mu.latency_ms), 0) AS avg_latency_ms
     FROM sessions s LEFT JOIN model_usage mu ON mu.session_id = s.id
     WHERE s.project_id = $1
     GROUP BY s.id ORDER BY s.started_at DESC`,
    [projectId],
  );
}

/** Totals per model for a project (or globally when projectId is null). */
export async function getUsageByModel(projectId?: number) {
  if (projectId) {
    return dbRows(
      `SELECT mu.model_name, SUM(mu.input_tokens) AS input_tokens, SUM(mu.output_tokens) AS output_tokens,
              SUM(mu.cost_usd) AS cost_usd, COUNT(*) AS calls, COALESCE(AVG(mu.latency_ms), 0) AS avg_latency_ms
       FROM model_usage mu JOIN sessions s ON s.id = mu.session_id
       WHERE s.project_id = $1 GROUP BY mu.model_name ORDER BY SUM(mu.cost_usd) DESC`,
      [projectId],
    );
  }
  return dbRows(
    `SELECT model_name, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
            SUM(cost_usd) AS cost_usd, COUNT(*) AS calls, COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
     FROM model_usage GROUP BY model_name ORDER BY SUM(cost_usd) DESC`,
  );
}

/**
 * "What did the AI actually do" timeline: commits joined with the agent
 * action (and its session/prompt) that triggered each one.
 */
export async function getCommitTimeline(projectId: number, limit = 100) {
  return dbRows(
    `SELECT g.id, g.commit_hash, g.branch, g.message, g.diff_summary,
            g.files_changed, g.additions, g.deletions, g.committed_at,
            a.id AS action_id, a.action_type, a.prompt,
            s.id AS session_id, s.started_at AS session_started_at
     FROM git_commits g
     LEFT JOIN agent_actions a ON a.id = g.action_id
     LEFT JOIN sessions s ON s.id = a.session_id
     WHERE g.project_id = $1
     ORDER BY g.committed_at DESC LIMIT $2`,
    [projectId, limit],
  );
}
