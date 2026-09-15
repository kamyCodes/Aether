/**
 * Electron main process — launches the packaged Aether backend (compiled
 * dist-server) on an ephemeral port, waits for /api/health, then opens the
 * BrowserWindow pointed at the local server (which serves dist/).
 *
 * Install dir vs data dir: the app NEVER writes user data next to the code.
 * AETHER_HOME defaults to %APPDATA%\Aether (see server/config.ts); the NSIS
 * installer creates it, and the server creates it on boot if missing.
 */
import { app, BrowserWindow, shell, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
// Packaged layout (asar OFF): <install>/resources/app/{dist,dist-server,...}.
// __dirname = .../resources/app/electron/dist → app root is two up.
// Dev layout: electron/dist/main.js → app root is two up as well.
const APP_ROOT = path.resolve(__dirname, '..', '..');
// server/tsconfig.json compiles with rootDir '..' → output mirrors the source
// tree: dist-server/server/index.js (not dist-server/index.js).
const DIST_SERVER = path.join(APP_ROOT, 'dist-server', 'server', 'index.js');

let serverProc: ChildProcess | null = null;
let serverPort = 0;
let quitting = false;

/** Pick a free loopback port by binding port 0. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => (p ? resolve(p) : reject(new Error('no free port'))));
    });
    s.on('error', reject);
  });
}

/** Wait until GET /api/health answers 200 (the server owns the readiness). */
function waitHealthy(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('backend did not become healthy in time'));
      else setTimeout(tick, 300);
    };
    tick();
  });
}

async function startBackend(): Promise<void> {
  serverPort = await freePort();
  const electronNode = process.execPath; // Electron binary can run Node scripts with ELECTRON_RUN_AS_NODE
  serverProc = spawn(electronNode, [DIST_SERVER], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(serverPort),
      HOST: '127.0.0.1',
      // Data dir: platform default (%APPDATA%\Aether) unless overridden —
      // same resolution the audited config module performs. Never an empty
      // string: an empty AETHER_HOME would resolve to cwd on some shells.
      ...(process.env.AETHER_HOME ? { AETHER_HOME: process.env.AETHER_HOME } : {}),
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on('exit', (code) => {
    if (!quitting) {
      dialog.showErrorBox(
        'Aether backend exited',
        `The Aether server process exited unexpectedly (code ${code}). Restart the app.`,
      );
      app.quit();
    }
  });
  await waitHealthy(serverPort);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0b0d14',
    title: 'Aether',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // External links open in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void win.loadURL(`http://127.0.0.1:${serverPort}`);
  }
}

app.whenReady().then(async () => {
  try {
    if (!isDev) await startBackend();
    createWindow();
  } catch (e) {
    dialog.showErrorBox(
      'Aether failed to start',
      `Backend startup failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
  serverProc?.kill();
});

app.on('window-all-closed', () => {
  quitting = true;
  serverProc?.kill();
  app.quit();
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Single instance lock — the backend owns a data dir; two instances would
// fight over SQLite-style locks and settings writes.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// dist-server resolution guard: fail loudly if packaging missed the server.
if (!isDev && !fs.existsSync(DIST_SERVER)) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'Installation incomplete',
      `Aether's backend bundle is missing (${DIST_SERVER}). The installation is broken — reinstall Aether.`,
    );
    app.quit();
  });
}
