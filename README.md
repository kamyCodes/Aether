# Aether

**A local-first AI development environment — a full IDE with an autonomous coding agent built in.**

Aether runs entirely on your machine: a desktop IDE (Electron + React) paired with a TypeScript backend that drives an autonomous agent. The agent reads and edits your code, runs shell commands, searches the repository, and operates git — always behind an explicit permission system, with every step streamed live into the UI.

The agent talks to any **OpenAI-compatible model gateway** (Aether ships with support for [OmniRoute](https://github.com/kamyCodes), a self-hosted gateway), so you choose the models — local or cloud — and your code and API keys never leave your machine.

---

## Why Aether

| | |
|---|---|
| 🖥 **Real desktop IDE** | Monaco editor, file tree, git panel, integrated terminal (node-pty), live preview, code map — panels that resize and remember. |
| 🤖 **Autonomous agent, permission-gated** | The agent plans, calls tools (edit / shell / search / git), and streams its work over WebSockets. Every tool call passes an allow/deny engine; approvals persist across restarts. |
| 🔒 **Local-first by design** | The gateway endpoint, ports, and data directory are the only configuration. Keys live in local settings, are masked in logs, and a "mock guard" refuses to run against fake gateways in production. |
| 🧠 **Project memory & history** | Embedded SQLite for task history, usage dashboards, and project memory — zero configuration. |
| 🪄 **Setup that actually tests** | The first-run wizard write-probes the data directory, auto-installs and tests OmniRoute, and shows a per-item pass/fail checklist. No manual API key or database configuration required. |
| 🛡 **Hardened by an audit gate** | CI scans every commit for hardcoded paths/ports, secrets, leftover mocks, and dead flags. Nothing ships without an explicit, documented allowlist entry. |

## Quickstart

### Install (Windows)

Grab the latest installer from [Releases](https://github.com/kamyCodes/Aether/releases) and run it. No Node.js required — the runtime is bundled.

- Per-user install to `%LOCALAPPDATA%\Programs\Aether` (no admin needed), with optional per-machine install.
- Desktop + Start Menu shortcuts; standard uninstaller in Apps & Features.
- Your data is **never** in the install directory: it lives in `%APPDATA%\Aether` (override with `AETHER_HOME`), and the uninstaller asks before touching it — never deletes silently.

### First-run flow

On first launch, Aether automatically:
1. Installs [OmniRoute](https://www.npmjs.com/package/omniroute) (the AI model gateway) globally if not already present.
2. Configures a free pollinations provider (no API key needed) and creates an inference API key.
3. Spawns OmniRoute as a child process that lives as long as Aether is running.
4. Opens an embedded SQLite database at `~/.aether/aether.db` (no Postgres, no Docker).

The setup wizard only asks you to confirm the data directory and projects folder. Everything else is automated.

### Run from source

```bash
git clone https://github.com/kamyCodes/Aether.git
cd Aether
npm install
npm run dev        # API server + Vite dev server together
```

Requirements: Node.js 22+. The UI opens on the Vite port; the API server's port/host come from `server/config.ts` (override with `PORT` / `HOST`; `AETHER_HOME` relocates per-user app data).

### First run

The setup wizard walks you through the four things Aether needs — data location, model gateway + API key, PostgreSQL (optional), and a default projects folder — and **verifies each one with a real call** before continuing. You can re-run it any time from **Settings → Run setup again…**, and skipped pieces degrade gracefully (history/usage turn off; the IDE keeps working).

## Production build

```bash
npm run build          # server (tsc) + web bundle (vite)
npm start              # build + serve from dist-server/

npm run package:win    # Windows installer → release/Aether-Setup-<version>.exe
npm run package:win:dir # unpacked build only (fast smoke-test target)
node scripts/smoke-packaged.mjs  # 11-point health check against the packaged exe
```

The installer build compiles the server, bundles the web app, bundles the Electron main process with esbuild, and hands off to electron-builder's NSIS target. Details, verification checklists, and the code-signing plan live in [`docs/windows-installer.md`](docs/windows-installer.md).

## Tests and checks

```bash
npm test           # node:test suite — regression, mock guard, model catalog,
                   # settings recovery, first-run setup, audit gate
npm run typecheck  # tsc (server + web) + CSS token lint
npm run audit:gate # production-readiness search gate
```

## Architecture

```
src/            React UI (Vite)
  components/   Panels, editors, modals — one file per component
  lib/          Store (zustand), API client, dialogs, theming/glass effects
server/         Express API + agent runtime (TypeScript, ESM)
  config.ts     SINGLE source of truth for ports/hosts/derived paths
  agent.ts      Agent loop: messages → model → tool calls (permission-gated)
  permissions.ts  Allow/deny engine for tool use
  tools.ts      Agent tool surface (edit, shell, search, git)
  setup.ts      First-run setup: real probes, single settings surface
  settings.ts   Typed settings store with schema versioning + recovery
  db.ts         Optional PostgreSQL (history, usage, memory)
  omni.ts       Gateway client (key masking — never logs full keys)
  mockGuard.ts  Refuses to run against mock/fake gateways in production
electron/       Desktop shell: main process, window lifecycle, backend spawn
shared/         Type definitions + version handshake shared by client & server
scripts/        Packaging, smoke tests, and the audit gate
migrations/     Database migrations
Aether-Skill-Pack/  Markdown skill packs loadable by the agent
docs/           Installer docs and archived audit reports
```

## The audit gate

`.github/workflows/audit-gate.yml` runs `scripts/audit-gate.mjs` plus typecheck and tests on every push across ubuntu and windows runners. The gate scans the tree for production-readiness violations — hardcoded paths/ports/hosts, secrets, mocks/stubs, dead feature flags, locale-dependent formatting — and fails on anything not allowlisted in `scripts/audit-allowlist.json`. Every allowlist entry carries a justification in the archived audit docs.

## Release pipeline

Tag `v*` (e.g. `v0.1.0`) and `.github/workflows/windows-installer.yml` takes over: it verifies the tag matches `package.json` **and** the frontend↔backend version handshake, runs the typecheck/test gates, builds the NSIS installer, smoke-tests the packaged exe on the runner, and attaches the installer + blockmap + `latest.yml` to a GitHub Release. Builds are unsigned during development (SmartScreen will ask — "More info → Run anyway"); the OV/EV code-signing plan is documented in [`docs/windows-installer.md`](docs/windows-installer.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, the three pre-push checks, and conventions (TypeScript everywhere, one component per file, config only from `server/config.ts`).

## License

Provided "AS IS" for installation and use — see the notice in [`build/license.txt`](build/license.txt). Third-party components remain under their own licenses.
