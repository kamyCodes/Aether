# Run doc — Aether dev preview

Dev app: Vite (React) frontend on **5173** + Express/WS backend via `tsx watch` on **5175**. `npm run dev` runs both under `concurrently -k`. Vite proxies `/api` and `/ws` (WebSocket, `ws: true`) → `http://localhost:5175`, and `/omni` → the gateway on 20128. Note: the `/ws` proxy entry is required in dev — without it the UI hangs at "WS connecting" (in prod Express serves the frontend directly, so no proxy is involved).

## Reproduce artifacts (fresh checkout)
1. Copy env files from the main checkout if present: `.env`, `.env.local` → worktree root (adapt `PORT`/`DATABASE_URL` if another checkout runs concurrently). Not needed when none exist.
2. Install deps: `npm install` (lockfile: `package-lock.json`).
3. Optional runtime extras (not required for the UI to render):
   - PostgreSQL reachable per `DATABASE_URL` or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` (default db `aether_db`); if absent the server logs `[db] FAILED to connect` and continues with DB features disabled.
   - OmniRoute-style gateway on `http://localhost:20128/v1` (default `baseUrl`); without it the model catalog is empty but the UI still loads.

## Run the server
- Foreground: `npm run dev` (kill with Ctrl+C; `concurrently -k` tears down both).
- Detached (Windows, different stdout/stderr files required):
  ```
  powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
  ```
- Verify: `powershell -NoProfile -Command "Get-Process -Id <pid>"`, then wait for `http://localhost:5173` to answer before use.
- Ports: prefer defaults 5173 (web) + 5175 (API); if 5173 is taken Vite auto-increments — read the chosen port from the log and register that URL. Override API port with `PORT=<n> npm run dev:server` if 5175 is busy.
