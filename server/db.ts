import pg from 'pg';
/**
 * SQLite database bootstrap and schema management. Owns migrations (the
 * `migrations/` folder) and exposes the raw `dbRows` helper used by dbStore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG_HOST, PG_PORT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root — works both from source (tsx) and compiled output (dist-server). */
export function projectRoot(): string {
  // dist-server/server/db.js -> project root; server/db.ts -> project root
  const fromDir = path.join(__dirname, '..');
  return path.basename(fromDir) === 'dist-server' ? path.join(fromDir, '..') : fromDir;
}

/**
 * PostgreSQL connection for Aether. All credentials come from environment
 * variables (or DATABASE_URL) — nothing is hardcoded. If the database is
 * unreachable the app still runs; DB-backed features degrade gracefully and
 * every write is fire-and-forget with logged errors.
 */

const config: pg.PoolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    }
  : {
      host: PG_HOST,
      port: PG_PORT,
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? '',
      database: process.env.PGDATABASE ?? 'aether_db',
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };

export const pool = new pg.Pool(config);

/** True when the last health check (or a successful query) succeeded. */
export let dbReady = false;

export function isDbReady() {
  return dbReady;
}

/** Check the connection is alive; returns the server version string or null. */
export async function checkConnection(): Promise<string | null> {
  try {
    const r = await pool.query('SELECT version() AS v');
    dbReady = true;
    return String(r.rows[0]?.v ?? 'PostgreSQL');
  } catch (err) {
    dbReady = false;
    throw err;
  }
}

const MIGRATIONS_DIR = path.join(projectRoot(), 'migrations');

/** Idempotent migrations: applied once, tracked in schema_migrations. */
export async function runMigrations(): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMP DEFAULT NOW()
  )`);
  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      console.log(`[db] applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `[db] migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Bring the database up; log success/failure clearly. Never throws. */
export async function initDb(): Promise<boolean> {
  try {
    const version = await checkConnection();
    const ran = await runMigrations();
    console.log(
      `[db] connected: ${version?.split(',')[0]}${ran.length ? ` — applied ${ran.length} migration(s): ${ran.join(', ')}` : ' — schema up to date'}`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[db] FAILED to connect or migrate — DB-backed features are disabled until this is fixed: ${msg}`,
    );
    console.error(
      '[db] configure via DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (default database: aether_db)',
    );
    return false;
  }
}

/** Fire-and-forget guarded write: logs instead of throwing. */
export function dbExec(sql: string, params: unknown[] = []): Promise<pg.QueryResult | null> {
  return pool.query(sql, params).catch((err) => {
    console.error(
      `[db] write failed: ${err instanceof Error ? err.message : String(err)} — sql: ${sql.slice(0, 120)}`,
    );
    return null;
  });
}

/** Read query returning rows, or [] when the DB is unavailable. */
export async function dbRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const r = await pool.query(sql, params);
    return r.rows as T[];
  } catch (err) {
    console.error(
      `[db] read failed: ${err instanceof Error ? err.message : String(err)} — sql: ${sql.slice(0, 120)}`,
    );
    return [];
  }
}

process.on('exit', () => void pool.end().catch(() => {}));
