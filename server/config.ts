/**
 * Shared runtime configuration — the SINGLE source of truth for ports,
 * hosts, and data locations (audit Section 1/2: no other file may declare a
 * port, bind host, or absolute path; they import from here).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function portEnv(name: string, fallback: number): number {
  const v = intEnv(name, fallback);
  return Math.min(v, 65535);
}

/** Primary HTTP + WebSocket port (vite proxies /api and /ws to it). */
export const PORT = portEnv('PORT', 5175);
/** Vite dev-server port (vite.config.ts reads this via env). */
export const VITE_PORT = portEnv('VITE_PORT', 5173);
/** OmniRoute gateway port (proxy target, upstream service). */
export const OMNI_PORT = portEnv('OMNI_PORT', 20128);
/** Bind host: loopback by default; set HOST=0.0.0.0 to expose on the LAN. */
export const HOST = process.env.HOST ?? '127.0.0.1';

/** Single Aether data directory. AETHER_HOME overrides (tests, sandboxing,
 *  portable installs). Platform default: %APPDATA%\Aether on Windows (the
 *  installer-created per-user data location), ~/.aether elsewhere. The
 *  install directory (Program Files / %LOCALAPPDATA%\Programs\Aether) is
 *  NEVER used for data — updates replace it wholesale (spec Section 4.1). */
export const DATA_DIR = process.env.AETHER_HOME
  ? path.resolve(process.env.AETHER_HOME)
  : process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Aether')
    : path.join(os.homedir(), '.aether');

// --- Derived bases (no other file may write a host/port literal) ---

/** Loopback form used when HOST is the wildcard — same-machine clients. */
export const LOOPBACK_HOST = '127.0.0.1';
/** Primary server bases for proxy targets and self-description. */
export const HTTP_BASE = `http://${HOST}:${PORT}`;
export const WS_BASE = `ws://${HOST}:${PORT}`;
export const OMNI_HTTP_BASE = `http://${HOST}:${OMNI_PORT}`;
/** Settings-schema default gateway URL (Sections 2/4 single declaration site). */
export const OMNI_DEFAULT_BASE_URL = `http://${HOST === '0.0.0.0' ? LOOPBACK_HOST : HOST}:${OMNI_PORT}/v1`;
/** Live-preview server: default port + URL prefix (ephemeral fallback at runtime). */
export const PREVIEW_DEFAULT_PORT = portEnv('PREVIEW_PORT', 4173);
export const PREVIEW_URL_BASE = 'http://localhost';
/** Base for `new URL()` request-path parsing — never contacted over the network. */
export const URL_PARSE_BASE = 'http://localhost';
/** PostgreSQL defaults (credentials still come from env only — Section 3). */
export const PG_HOST = process.env.PGHOST ?? 'localhost';
export const PG_PORT = portEnv('PGPORT', 5432);

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const config = { PORT, VITE_PORT, OMNI_PORT, HOST, DATA_DIR } as const;
