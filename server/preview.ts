import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { WorkspaceManager } from './workspace.js';
import { PREVIEW_DEFAULT_PORT, PREVIEW_URL_BASE, URL_PARSE_BASE } from './config.js';

const LIVE_RELOAD_SNIPPET = `<script>(function(){var es=new EventSource('/__aether_livereload');es.onmessage=function(e){if(e.data==='reload')location.reload();};})();</script>`;

/** Serves a workspace directory as a live preview with reload-on-change. */
export class PreviewManager extends EventEmitter {
  private server: http.Server | null = null;
  private port = 0;
  private roots = new Map<string, string>(); // portkey->root

  async startFor(workspaceRoot: string, preferredPort = PREVIEW_DEFAULT_PORT): Promise<number> {
    if (this.server && this.roots.get('root') === workspaceRoot) return this.port;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.roots.set('root', workspaceRoot);
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', URL_PARSE_BASE);
      if (url.pathname === '/__aether_livereload') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const listener = () => res.write('data: reload\n\n');
        this.on('change', listener);
        req.on('close', () => this.off('change', listener));
        return;
      }
      let p = path.join(workspaceRoot, decodeURIComponent(url.pathname));
      if (!p.startsWith(workspaceRoot)) { res.writeHead(403); res.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p)) {
        // SPA fallback: serve index.html if present
        const idx = path.join(workspaceRoot, 'index.html');
        if (fs.existsSync(idx)) p = idx;
        else { res.writeHead(404); res.end('Not found'); return; }
      }
      const ext = path.extname(p);
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
      let content: Buffer = fs.readFileSync(p);
      if (ext === '.html') content = Buffer.concat([content, Buffer.from(LIVE_RELOAD_SNIPPET)]);
      res.end(content);
    });
    this.port = await new Promise((resolve) => {
      this.server!.listen(preferredPort, () => resolve(preferredPort));
      this.server!.on('error', () => {
        // port busy — retry ephemeral
        this.server!.listen(0, () => resolve((this.server!.address() as { port: number }).port));
      });
    });
    return this.port;
  }

  notifyChange() {
    this.emit('change');
  }

  get url() {
    return this.port ? `${PREVIEW_URL_BASE}:${this.port}` : '';
  }

  stop() {
    this.server?.close();
    this.server = null;
    this.port = 0;
  }
}
