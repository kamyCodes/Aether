/**
 * OmniRoute child-process lifecycle: spawn, poll until ready, kill.
 * The spawned process dies when Aether's backend exits — no orphaned processes.
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { OMNI_PORT } from './config.js';

/** Poll interval (ms) while waiting for OmniRoute to become ready. */
const POLL_INTERVAL = 500;
/** Max wait (ms) before giving up on OmniRoute startup. */
const STARTUP_TIMEOUT = 120_000;

/**
 * Resolve the path to OmniRoute's JS entry point, then spawn `node` directly
 * with that entry point.  This avoids the `cmd.exe` / shell wrapper on Windows,
 * which would orphan child processes when we call `child.kill()`.
 */
function resolveOmniEntry(): { cmd: string; args: string[] } {
  try {
    // npm global bin: find the .cmd wrapper, then derive the entry path
    const cmd = process.platform === 'win32' ? 'where omniroute' : 'which omniroute';
    const results = execSync(cmd, { encoding: 'utf8' }).trim().split('\n');

    if (process.platform === 'win32') {
      // Resolve from the .cmd wrapper path: <npm-global>/omniroute.cmd
      // -> <npm-global>/node_modules/omniroute/bin/omniroute.mjs
      const cmdPath = results.find((p) => p.trim().endsWith('.cmd'));
      if (cmdPath) {
        const base = cmdPath.trim().replace(/omniroute\.cmd$/i, '');
        const entry = `${base}node_modules/omniroute/bin/omniroute.mjs`;
        return { cmd: process.execPath, args: [entry] };
      }
    }

    // Unix: resolve from the symlink / shim
    const shimPath = results[0].trim();
    // shimPath typically points to node_modules/omniroute/bin/omniroute.mjs
    // or is a wrapper.  Fallback: resolve the node_modules path.
    const nmIdx = shimPath.indexOf('node_modules/omniroute/');
    if (nmIdx >= 0) {
      const base = shimPath.substring(0, nmIdx + 'node_modules/omniroute/'.length);
      const entry = `${base}bin/omniroute.mjs`;
      return { cmd: process.execPath, args: [entry] };
    }

    // Last resort: try running via npx (slower but works)
    return { cmd: 'npx', args: ['omniroute'] };
  } catch {
    // Fallback: try spawning omniroute directly (will work on PATH)
    return { cmd: 'omniroute', args: [] };
  }
}

/**
 * Spawn `omniroute serve --no-open` as a child process.
 *
 * On every platform we spawn `node <entry-point> serve --no-open` directly,
 * which avoids the cmd.exe / shell wrapper that orphans children on Windows.
 * The process is NOT detached — it dies when this process exits.
 *
 * Returns the ChildProcess handle (caller must kill it on shutdown).
 */
export function spawnOmniRoute(): ChildProcess {
  const { cmd, args } = resolveOmniEntry();
  const child = spawn(cmd, [...args, 'serve', '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[omni-serve] ${line}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[omni-serve] ${line}`);
  });

  child.on('error', (err) => {
    console.error(`[omni-serve] process error: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    console.log(`[omni-serve] exited (code=${code}, signal=${signal})`);
  });

  return child;
}

/**
 * Kill the OmniRoute child process. Sends SIGTERM first, SIGKILL after 3s.
 * On Windows, SIGTERM is mapped to taskkill (graceful), then /F (force).
 */
export function killOmniRoute(child: ChildProcess): void {
  if (child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already dead */
  }
  setTimeout(() => {
    if (!child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* best effort */
      }
    }
  }, 3_000).unref();
}

/**
 * Poll GET /v1/models until it returns 200 (OmniRoute is ready).
 * Throws if the timeout is exceeded.
 */
export async function waitForOmniReady(apiKey?: string): Promise<void> {
  const url = `http://127.0.0.1:${OMNI_PORT}/v1/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const deadline = Date.now() + STARTUP_TIMEOUT;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(
    `OmniRoute did not become ready within ${STARTUP_TIMEOUT / 1000}s at ${url} — last error: ${lastError}`,
  );
}
