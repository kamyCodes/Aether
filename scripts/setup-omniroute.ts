/**
 * Automated OmniRoute setup — runs once during Aether's first-run installer.
 *
 * Verified against OmniRoute v3.8.49.
 *
 * Auth flow for fresh installs (no existing api_keys rows):
 *   1. Run `omniroute setup --non-interactive`.
 *   2. Login via POST /api/auth/login with the INITIAL_PASSWORD (read from
 *      OmniRoute's bundled .env, defaults to CHANGEME). This is a public
 *      route — no auth needed to call it. Returns a JWT session cookie.
 *   3. Create the inference API key via POST /api/keys with the session
 *      cookie. Session auth is accepted by OmniRoute's requireManagementAuth.
 *   4. Set a real admin password via `omniroute setup --password <gen>` to
 *      replace the insecure default.
 *
 * Idempotent: checks for existing "aether" key before creating.
 * Fails loudly on non-zero exit codes.
 */
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = process.env.AETHER_HOME
  ? path.resolve(process.env.AETHER_HOME)
  : process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Aether')
    : path.join(os.homedir(), '.aether');

const OMNIROUTE_DB = path.join(os.homedir(), '.omniroute', 'storage.sqlite');
const OMNIROUTE_PORT = process.env.OMNI_PORT ?? '20128';
const OMNI_BASE_URL = `http://127.0.0.1:${OMNIROUTE_PORT}/v1`;

interface SetupResult {
  ok: boolean;
  apiKey?: string;
  baseUrl?: string;
  error?: string;
}

/** Run a shell command, returning stdout. Throws on non-zero exit. */
function run(cmd: string, opts: { timeout?: number } = {}): string {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout ?? 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Command failed: ${cmd}\n${msg}`);
  }
}

/** Check if a command is available on PATH. */
function isInstalled(cmd: string): boolean {
  try {
    run(`${cmd} --version`, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Generate a cryptographically secure random password. */
function generatePassword(): string {
  return `aeth-${randomBytes(16).toString('hex')}`;
}

/** Read existing settings from ~/.aether/settings.json. */
function readSettings(): Record<string, unknown> | null {
  const file = path.join(DATA_DIR, 'settings.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Write settings to ~/.aether/settings.json (atomic write). */
function writeSettings(data: Record<string, unknown>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'settings.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Check if an "aether" inference key exists in OmniRoute's database.
 * Uses better-sqlite3 to read directly (no server needed).
 */
function getExistingAetherKey(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(OMNIROUTE_DB, { readonly: true });
    const row = db
      .prepare("SELECT key FROM api_keys WHERE name = 'aether' AND revoked_at IS NULL")
      .get() as { key: string } | undefined;
    db.close();
    return row?.key ?? null;
  } catch {
    return null;
  }
}

/**
 * Read OmniRoute's INITIAL_PASSWORD from its bundled .env file.
 * Falls back to 'CHANGEME' if the .env can't be read.
 */
function getOmniRoutePassword(): string {
  try {
    const omniModuleDir = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const envPath = path.join(omniModuleDir, 'omniroute', '.env');
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^INITIAL_PASSWORD=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // can't read .env — fall back
  }
  return 'CHANGEME';
}

/**
 * Authenticate against OmniRoute's login endpoint and return the session cookie.
 * POST /api/auth/login is a public route (no auth needed).
 */
async function loginAndGetYumCookie(): Promise<string> {
  const password = getOmniRoutePassword();
  console.log(`[setup-omniroute] logging in to OmniRoute (password from .env)...`);

  const res = await fetch(`http://127.0.0.1:${OMNIROUTE_PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Login failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  // Extract the auth_token cookie from the Set-Cookie header
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const authCookie = setCookie.find((c) => c.startsWith('auth_token='));
  if (!authCookie) throw new Error('Login succeeded but no auth_token cookie returned');

  // Return just the cookie value (name=value)
  const cookieValue = authCookie.split(';')[0];
  console.log(`[setup-omniroute] login successful`);
  return cookieValue;
}

/**
 * Create an inference API key via OmniRoute's HTTP API.
 * Uses the JWT session cookie from /api/auth/login for auth.
 */
async function createAetherKey(cookie: string): Promise<string> {
  console.log(`[setup-omniroute] POST /api/keys with session cookie`);

  const body = JSON.stringify({
    name: 'aether',
    scopes: ['self:usage'],
  });

  const res = await fetch(`http://127.0.0.1:${OMNIROUTE_PORT}/api/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /api/keys failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { key?: string; error?: string };
  if (data.error) throw new Error(`POST /api/keys returned error: ${data.error}`);
  if (!data.key) throw new Error('POST /api/keys responded but no key in response body');
  return data.key;
}

/**
 * Wait for a port to become free after killing a process.
 * Polls every 500ms up to maxMs, confirming the port is no longer LISTENING.
 */
async function waitForPortFree(port: string, maxMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const result = execSync(
        process.platform === 'win32'
          ? `netstat -ano | grep ":${port}" | grep LISTEN || true`
          : `lsof -i :${port} -sTCP:LISTEN || true`,
        { encoding: 'utf8', timeout: 2_000 },
      ).trim();
      if (!result) return true;
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Start OmniRoute temporarily, create API key, kill it.
 * Returns the created API key.
 */
async function startServerAndCreateKey(): Promise<string> {
  console.log('[setup-omniroute] starting OmniRoute temporarily to create API key...');
  const server = spawn('omniroute', ['serve', '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    shell: process.platform === 'win32',
  });

  try {
    // Wait for server to be ready (up to 90s — OmniRoute can be slow to start)
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${OMNIROUTE_PORT}/v1/models`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) break;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Authenticate via session cookie, then create inference API key
    const cookie = await loginAndGetYumCookie();
    console.log('[setup-omniroute] creating inference API key...');
    const apiKey = await createAetherKey(cookie);
    console.log('[setup-omniroute] API key created successfully');
    return apiKey;
  } finally {
    // Kill the temporary server and WAIT for port to be free
    try {
      server.kill('SIGTERM');
    } catch {
      /* best effort */
    }
    const portFree = await waitForPortFree(OMNIROUTE_PORT, 15_000);
    if (!portFree) {
      console.warn(
        `[setup-omniroute] warning: port ${OMNIROUTE_PORT} still occupied after killing OmniRoute`,
      );
    } else {
      console.log(`[setup-omniroute] port ${OMNIROUTE_PORT} confirmed free`);
    }
  }
}

/**
 * Main setup function — idempotent, safe to run multiple times.
 */
export async function runSetup(): Promise<SetupResult> {
  try {
    // Step 1: Ensure omniroute is installed
    if (!isInstalled('omniroute')) {
      console.log('[setup-omniroute] installing omniroute globally...');
      run('npm install -g omniroute', { timeout: 120_000 });
      console.log('[setup-omniroute] omniroute installed');
    } else {
      console.log('[setup-omniroute] omniroute already installed');
    }

    // Step 2: Check if setup already done (aether key exists)
    const existingKey = getExistingAetherKey();
    if (existingKey) {
      console.log('[setup-omniroute] setup already complete — reusing existing key');
      return { ok: true, apiKey: existingKey, baseUrl: OMNI_BASE_URL };
    }

    // Step 3: Run omniroute setup WITHOUT password
    console.log('[setup-omniroute] running omniroute setup...');
    run('omniroute setup --non-interactive', { timeout: 30_000 });

    // Verify DB state
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      const db = new Database(OMNIROUTE_DB, { readonly: true });
      const keyCount = db.prepare('SELECT count(*) as c FROM api_keys').get() as { c: number };
      console.log(`[setup-omniroute] verified: api_keys has ${keyCount.c} rows (expect 0)`);
      db.close();
    } catch (err) {
      console.warn(`[setup-omniroute] could not verify DB: ${err instanceof Error ? err.message : err}`);
    }

    // Step 4: Add pollinations provider (free, no API key needed)
    console.log('[setup-omniroute] adding pollinations provider...');
    try {
      run(
        'omniroute setup --non-interactive --add-provider --provider pollinations --test-provider',
        { timeout: 30_000 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already') && !msg.includes('exists')) {
        console.warn(`[setup-omniroute] pollinations provider: ${msg} (continuing)`);
      }
    }

    // Step 5: Start server, create API key, kill server (with port confirmation)
    const apiKey = await startServerAndCreateKey();

    // Step 6: NOW set the admin password (second omniroute setup call)
    // This sets requireLogin=true without touching api_keys rows.
    const password = generatePassword();
    console.log('[setup-omniroute] setting admin password...');
    run(`omniroute setup --non-interactive --password "${password}"`, { timeout: 15_000 });
    console.log('[setup-omniroute] admin password configured');

    // Step 7: Write to settings.json
    const existing = readSettings() ?? {};
    const settings = {
      ...existing,
      omni: {
        ...((existing.omni as Record<string, unknown>) ?? {}),
        baseUrl: OMNI_BASE_URL,
        apiKey,
      },
    };
    writeSettings(settings);
    console.log('[setup-omniroute] settings.json updated');

    return { ok: true, apiKey, baseUrl: OMNI_BASE_URL };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[setup-omniroute] FAILED: ${error}`);
    return { ok: false, error };
  }
}

// Allow running directly: npx tsx scripts/setup-omniroute.ts
const isMainModule =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
   import.meta.url.endsWith('/scripts/setup-omniroute.ts') ||
   process.argv[1].includes('setup-omniroute'));

if (isMainModule) {
  runSetup()
    .then((r) => {
      if (r.ok) {
        console.log(`\n✓ Setup complete. API key: ${r.apiKey?.slice(0, 12)}...`);
        console.log(`  Base URL: ${r.baseUrl}`);
      } else {
        console.error(`\n✗ Setup failed: ${r.error}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
