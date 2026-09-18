/**
 * SQLite database bootstrap and schema management. Owns migrations (the
 * `migrations/` folder) and exposes the raw `dbRows` helper used by dbStore.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root — works both from source (tsx) and compiled output (dist-server). */
export function projectRoot(): string {
  // dist-server/server/db.js -> project root; server/db.ts -> project root
  const fromDir = path.join(__dirname, '..');
  return path.basename(fromDir) === 'dist-server' ? path.join(fromDir, '..') : fromDir;
}

// ---------- SQLite bootstrap ----------

const DB_PATH = path.join(DATA_DIR, 'aether.db');
let _db: Database.Database | null = null;

/** Get or open the SQLite database. Never throws on first call — returns null if unavailable. */
function getDb(): Database.Database | null {
  if (_db) return _db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000');
    _db.pragma('synchronous = NORMAL');
    return _db;
  } catch (err) {
    console.error(`[db] FAILED to open SQLite at ${DB_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** True when the database is open and schema is applied. */
export let dbReady = false;

export function isDbReady() {
  return dbReady;
}

// ---------- Schema ----------

/**
 * All tables, matching the exact Postgres schema from migrations/001_init.sql
 * but adapted for SQLite types (INTEGER PRIMARY KEY AUTOINCREMENT, TEXT,
 * REAL, datetime('now')). Idempotent — CREATE TABLE IF NOT EXISTS.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    language TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_root_path_key ON projects (root_path);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    path TEXT NOT NULL,
    content TEXT,
    last_modified TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_key ON files (project_id, path);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS agent_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    action_type TEXT NOT NULL,
    file_id INTEGER REFERENCES files(id),
    prompt TEXT,
    result TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    action_id INTEGER REFERENCES agent_actions(id),
    model_name TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER,
    cost_usd REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS git_commits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    action_id INTEGER REFERENCES agent_actions(id),
    commit_hash TEXT UNIQUE NOT NULL,
    branch TEXT,
    message TEXT,
    diff_summary TEXT,
    files_changed INTEGER,
    additions INTEGER,
    deletions INTEGER,
    committed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_model_usage_session ON model_usage (session_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_project_time ON model_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_agent_actions_session ON agent_actions (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (project_id);
`;

/** Bring the database up; log success/failure clearly. Never throws. */
export function initDb(): boolean {
  const db = getDb();
  if (!db) {
    console.error('[db] SQLite unavailable — DB-backed features are disabled');
    return false;
  }
  try {
    db.exec(SCHEMA_SQL);
    dbReady = true;
    console.log(`[db] SQLite ready: ${DB_PATH}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[db] FAILED to apply schema — DB-backed features are disabled: ${msg}`);
    dbReady = false;
    return false;
  }
}

/**
 * Fire-and-forget guarded write: logs instead of throwing.
 * better-sqlite3 is synchronous; we wrap to keep the async signature
 * used by callers (dbStore.ts).
 */
export function dbExec(sql: string, params: unknown[] = []): Promise<{ rows: { id: number; changes: number }[] } | null> {
  const db = getDb();
  if (!db) return Promise.resolve(null);
  try {
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);
    return Promise.resolve({
      rows: [{ id: Number(result.lastInsertRowid), changes: result.changes }],
    });
  } catch (err) {
    console.error(
      `[db] write failed: ${err instanceof Error ? err.message : String(err)} — sql: ${sql.slice(0, 120)}`,
    );
    return Promise.resolve(null);
  }
}

/** Read query returning rows, or [] when the DB is unavailable. */
export function dbRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = getDb();
  if (!db) return Promise.resolve([]);
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as T[];
    return Promise.resolve(rows);
  } catch (err) {
    console.error(
      `[db] read failed: ${err instanceof Error ? err.message : String(err)} — sql: ${sql.slice(0, 120)}`,
    );
    return Promise.resolve([]);
  }
}

/** Close the database on process exit. */
process.on('exit', () => {
  if (_db) {
    try { _db.close(); } catch { /* best effort */ }
  }
});
