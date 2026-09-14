#!/usr/bin/env node
/**
 * Section 2 runtime proof: occupy the configured port with a placeholder
 * HTTP server (answers 418), launch the Aether server, and record whether it
 * (a) fails with a specific named error (EADDRINUSE), (b) falls back to
 * another port, or (c) somehow co-binds the occupied port (DANGER — Windows
 * SO_REUSEADDR semantics). Evidence is written to
 * audit-evidence/s2-port-test.txt.
 *
 * Ownership of the occupied port is decided by CONTENT, not by connect
 * success — the blocker always answers 418, only the real server can answer
 * an API route.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefault, hostDefault } from '../read-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'report', 'audit-evidence', 's2-port-test.txt');
const HOST = hostDefault();
const PORT = configDefault('PORT');
const OBSERVE_MS = 20_000; // tsx cold boot is slow; give it a real window

const log = [];
const write = (s) => {
  log.push(s);
  console.log(s);
};

// 1. Declare the plan.
const src = fs.readFileSync(path.join(ROOT, 'server', 'config.ts'), 'utf8');
const defPort = src.match(/portEnv\('PORT',\s*(\d+)\)/)?.[1];
write(`config.ts declares PORT default: ${defPort ?? 'NOT FOUND'}`);
write(
  `Test plan: occupy ${HOST}:${PORT} with a 418-responding placeholder HTTP server, then start Aether and observe for ${OBSERVE_MS / 1000}s.`,
);

// 2. Occupy the port with an HTTP server that always answers 418 "blocker".
const blocker = http.createServer((_req, res) => {
  res.writeHead(418, { 'Content-Type': 'text/plain' });
  res.end('blocker');
});
await new Promise((res, rej) =>
  blocker.once('error', rej).once('listening', res).listen(PORT, HOST),
);
write(`[blocker] HTTP 418 responder listening on ${HOST}:${PORT} — port is now occupied.`);

// 3. Launch the Aether server.
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));

const whoAnswers = (port) =>
  new Promise((res) => {
    const req = http.get(
      { host: HOST, port, path: '/api/health/gateway-guard', timeout: 1500 },
      (r) => {
        r.resume();
        res(r.statusCode === 418 ? 'BLOCKER' : `SERVER (status ${r.statusCode})`);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      res('NO-HTTP');
    });
    req.on('error', () => res('NO-HTTP'));
  });
const connectable = (port) =>
  new Promise((res) => {
    const s = net.connect(port, HOST);
    s.once('connect', () => {
      s.destroy();
      res(true);
    });
    s.once('error', () => res(false));
    setTimeout(() => {
      s.destroy();
      res(false);
    }, 1000);
  });

// 4. Observe: exit w/ named error, fallback bind, co-bind, or timeout.
let outcome = `TIMEOUT: server ran the full window without exiting, without binding an alternate port, and the occupied port still answers BLOCKER (server never took the port; treat as EADDRINUSE-suppressed or slow boot — review output).`;
const start = Date.now();
while (Date.now() - start < OBSERVE_MS) {
  await new Promise((r) => setTimeout(r, 500));
  if (child.exitCode !== null || child.signalCode !== null) {
    const eaddrinuse = /EADDRINUSE|address already in use/i.test(output);
    outcome = eaddrinuse
      ? `EXITED with a specific named error (EADDRINUSE in output) — acceptable per Section 2: "a specific named error".`
      : `EXITED (code=${child.exitCode}, signal=${child.signalCode}) but output did not name the conflict — review output below.`;
    break;
  }
  const owner = await whoAnswers(PORT);
  if (owner.startsWith('SERVER')) {
    outcome = `DANGER: the occupied port ${PORT} answered with real server content — the server CO-BOUND a port held by another process (Windows reuse semantics). Investigate binding.`;
    break;
  }
  let fallback = false;
  for (const p of [PORT + 1, PORT + 2, PORT + 3]) {
    if ((await whoAnswers(p)) !== 'NO-HTTP' && (await connectable(p))) {
      outcome = `FALLBACK: server bound ${p} (default ${PORT} was occupied).`;
      fallback = true;
      break;
    }
  }
  if (fallback) break;
}

child.kill('SIGKILL');
blocker.close();
write(`[result] ${outcome}`);
write('--- server output (verbatim) ---');
write(output || '(no output captured)');

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, log.join('\n'));
console.log(`\nEvidence written to ${EVIDENCE}`);
