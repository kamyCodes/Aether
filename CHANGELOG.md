# Changelog

All notable changes to Aether are documented here. Each installer build adds an entry for its version; edit freely — re-running the build never overwrites an existing entry.

## [0.1.3] — 2026-09-18

### Critical fix

- **Native module crash on startup.** `better-sqlite3` was compiled for system Node.js but the packaged app runs under Electron's bundled Node.js (different ABI). Added `@electron/rebuild` to the build pipeline so native modules are compiled against Electron's headers. Also made the `better-sqlite3` import graceful — if the native module still fails to load, the app runs with DB features disabled instead of crashing.

## [0.1.2] — 2026-09-18

### Zero-config first run

- **SQLite replaces Postgres.** No Docker, no database setup — data lives in `~/.aether/aether.db` with `better-sqlite3`.
- **OmniRoute auto-setup.** First-run installer automates OmniRoute installation, provider configuration, and API key creation end-to-end. No dashboard visits, no copy-pasted keys.
- **OmniRoute lifecycle management.** OmniRoute spawns as a child process on backend startup, polls until ready, and is killed cleanly on shutdown — no orphaned processes.
- **Port conflict fallback.** If port 20128 is occupied by an orphaned process, Aether kills the blocker and retries once. If the retry fails, a clear error message is shown instead of a silent hang.

### UI polish

- **X close buttons on all modals.** Settings, Confirm, and Command Palette modals now have visible close buttons (top-right corner). Keyboard `Escape` parity where applicable.

### Release engineering

- **Stable download filename.** Website download button points to `Aether-Setup-latest.exe` — no more broken links on version bumps.
- **Website fallback text.** Version number, changelog, and checksum auto-fetch from GitHub API with hardcoded fallback on failure.

### Quality

- 57 tests passing; typecheck clean across all projects.

## [0.1.1] — 2026-09-17

### Sessions survive restarts

- **Chat threads persist per workspace.** Conversations are mirrored to disk (atomic, debounced writes) and restored on boot — closing the app no longer loses your threads, active chat, or task bindings.
- **Terminal tabs come back after a restart.** Tab titles, working directories, and workspace scoping persist; shells respawn fresh with scrollback restored from the client's replay cache.
- **No more restart ghosts.** Any task that was running/planning/queued when the backend died is marked failed on boot *before* anything restores from disk, so a dead task can never come back looking alive.

### UI refinements

- New **confirm modal** for destructive actions (replaces ad-hoc confirmations).
- Reworked **settings modal**, **terminal panel** (command history with exit codes and output tails), **composer**, **agent chat**, and **status bar**.
- Brand mark and welcome screen polish; expanded glass design tokens.

### Release engineering

- **Previous installers are now archived.** Building a new version moves the old installer + blockmap + checksum into `archives/<version>/` instead of wiping it.
- **Automatic changelog entries.** Each installer build writes its version's entry to this file, including artifact sizes and SHA-256 checksums, derived from git history.
- `.gitignore` revised and expanded (builder droppings, env files, editor cruft).

### Quality

- 58 tests passing, including new suites for session persistence and the restart ghost sweep.
