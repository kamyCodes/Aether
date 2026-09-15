/**
 * Smoke test for the packaged build (release/win-unpacked or an installed
 * copy). Launches Aether.exe with an ISOLATED AETHER_HOME sandbox, waits for
 * the backend to come healthy, and asserts the packaged app's real HTTP
 * surface answers: health + version handshake, setup state (fresh install ⇒
 * incomplete), settings defaults, and the frontend bundle.
 *
 * Usage: node scripts/smoke-packaged.mjs [path-to-Aether.exe]
 * Exit 0 = all checks passed. The spawned app is always cleaned up.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const exe = process.argv[2] ?? path.resolve('release', 'win-unpacked', 'Aether.exe');
if (!fs.existsSync(exe)) {
  console.error(`executable not found: ${exe}`);
  process.exit(1);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-smoke-'));
console.log(`smoke: ${exe}`);
console.log(`sandbox AETHER_HOME: ${home}`);

const proc = spawn(exe, [], {
  env: { ...process.env, AETHER_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
});
let procOutput = '';
proc.stdout?.on('data', (d) => (procOutput += d.toString()));
proc.stderr?.on('data', (d) => (procOutput += d.toString()));

const cleanup = () => {
  try {
    if (process.platform === 'win32') {
      // Kill the whole process tree (Electron spawns the backend as a child).
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill();
    }
  } catch {
    /* already gone */
  }
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};
process.on('exit', cleanup);

/** Find the backend port: the listener belongs to the backend child process
 *  (not the Electron PID we spawned), so PID matching is unreliable. Instead,
 *  parse the port straight out of the server's own boot banner —
 *  "Aether backend listening on http://127.0.0.1:PORT" — and health-check it. */
function findBackendPort(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const m = procOutput.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        const port = Number(m[1]);
        http
          .get({ host: '127.0.0.1', port, path: '/api/health', timeout: 3000 }, (res) => {
            res.resume();
            if (res.statusCode === 200) resolve(port);
            else setTimeout(tick, 500);
          })
          .on('error', () => setTimeout(tick, 500));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`backend banner never appeared. Output:\n${procOutput.slice(-2000)}`));
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });
}

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: `/api${p}`, timeout: 8000 }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  const port = await findBackendPort();
  check('backend listener', true, `127.0.0.1:${port}`);

  const health = await getJson(port, '/health');
  check('GET /api/health', health.status === 200 && health.body.ok === true);
  check(
    'version handshake present',
    typeof health.body.version === 'string' && health.body.version.length > 0,
    health.body.version,
  );

  const setup = await getJson(port, '/setup/state');
  check(
    'fresh install: setup incomplete',
    setup.status === 200 && setup.body.complete === false,
  );
  check(
    'data dir defaults to the sandbox',
    setup.body.dataDir === home,
    setup.body.dataDir,
  );
  check('data dir writable probe', setup.body.dataDirWritable === true);
  check(
    'omni default endpoint present',
    typeof setup.body.defaults?.omniBaseUrl === 'string' && setup.body.defaults.omniBaseUrl.length > 0,
    setup.body.defaults?.omniBaseUrl,
  );

  const settings = await getJson(port, '/settings');
  check('GET /api/settings', settings.status === 200 && !!settings.body.omni);
  // settings.json only exists after the first save — perform one via the real
  // API, then assert the schema version stamp landed on disk.
  const put = await new Promise((resolve) => {
    const body = JSON.stringify(settings.body);
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/settings', method: 'PUT', timeout: 8000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', () => resolve(0));
    req.write(body);
    req.end();
  });
  check('PUT /api/settings round-trip', put === 200);
  check(
    'settings schema version stamped on disk',
    (() => {
      try {
        const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
        return typeof onDisk.schemaVersion === 'number';
      } catch {
        return false;
      }
    })(),
  );

  const frontend = await new Promise((resolve) => {
    http
      .get({ host: '127.0.0.1', port, path: '/', timeout: 8000 }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', () => resolve({ status: 0, body: '' }));
  });
  check(
    'frontend bundle served',
    frontend.status === 200 && frontend.body.includes('<div id="root">'),
  );
} catch (e) {
  check('smoke run', false, e instanceof Error ? e.message : String(e));
} finally {
  cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSMOKE: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
