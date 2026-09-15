# Aether Windows Installer

## Build

```bash
npm install                 # includes electron + electron-builder devDeps
npm run package:win         # → release/Aether-Setup-<version>.exe
npm run package:win:dir     # unpacked build only (fast smoke test)
```

The script compiles the server (`tsc`), the web bundle (`vite`), the Electron
main process (`esbuild`), then invokes electron-builder's NSIS target.

## What the installer does (standard Windows wizard)

| Step | Behavior |
| --- | --- |
| Welcome | App name, version, icon (electron-builder NSIS, `oneClick: false`) |
| License | `build/license.txt`, acceptance required to continue |
| Install location | Default `%LOCALAPPDATA%\Programs\Aether` (per-user, no admin needed); user-editable (`allowToChangeInstallationDirectory`). `allowElevation: true` offers a per-machine install on demand |
| Shortcuts | Desktop + Start Menu, both on by default, both removed at uninstall |
| Progress | Real file-copy progress from NSIS |
| Finish | "Run Aether" checkbox, checked by default |
| Uninstaller | Registered in Apps & Features with name/version/publisher/icon; removes shortcuts + registry entries; **asks** whether to also delete `%APPDATA%\Aether` (never silent — `build/installer.nsh`) |
| Silent install | NSIS `/S` flag works out of the box (`Aether-Setup-1.0.0.exe /S`), same defaults |

**Program files vs user data are strictly separate.** The install directory is
fully replaceable on update and contains zero user data. Everything the user
generates lives in `AETHER_HOME`:

- Windows: `%APPDATA%\Aether` (default; `AETHER_HOME` env overrides — see
  `server/config.ts`, the single path-resolution module from the audit)
- macOS/Linux: `~/.aether`

The NSIS `customInit` macro pre-creates the data dir; the backend re-creates
it on every boot if missing.

## Code-signing plan (required before wide distribution)

Unsigned installers trigger SmartScreen ("Windows protected your PC") and
Chrome/Edge flag the download. Plan, in order:

1. **Now (development/testing):** unsigned builds are fine for internal QA —
   SmartScreen shows "More info → Run anyway".
2. **Pilot:** buy an **OV code-signing certificate** (~$200–400/yr, e.g.
   Sectigo/Certum) and set the env vars electron-builder reads:

   ```powershell
   $env:CSC_LINK = "C:\path\to\cert.pfx"
   $env:CSC_KEY_PASSWORD = "..."
   npm run package:win
   ```

   Reputation builds up after enough clean downloads (typically weeks).
3. **GA:** an **EV certificate** (hardware token, ~$300–600/yr) gives
   immediate SmartScreen reputation — no waiting period. electron-builder
   signs the `.exe`, the uninstaller, and the bundled `node-pty` native
   binaries via `signAndEditExecutable`.
4. Optionally publish via GitHub Releases with the `.blockmap` (already
   emitted) so future delta updates only download changed blocks.

## First-run flow (after install)

1. Installer runs → "Run Aether" → Electron main starts the packaged backend
   on a free loopback port and opens the window.
2. No `setup.json` in `AETHER_HOME` → the first-run wizard blocks the UI:
   data location (real write probe) → model gateway (real `/models` call) →
   database (real `SELECT version()`) → projects folder (create + probe) →
   review with masked secrets → per-item pass/fail checklist.
3. Skipped steps leave the corresponding features visibly "not configured"
   in the app (gateway: `omniConnected: false`; database: DB features off).
4. The wizard is re-runnable from **Settings → Run setup again…** at any time.

## Verification checklist (run once per release on a clean VM)

- [ ] Install on a machine with no Node.js installed — app must work
      (runtime is bundled, nothing assumed).
- [ ] Walk the full wizard: welcome → license → location → shortcuts →
      progress → finish-with-launch. Each numbered behavior in the table above
      must actually happen — watch it, don't assume defaults.
- [ ] After install: app appears in Apps & Features with correct
      name/version/publisher; uninstall entry runs the uninstaller.
- [ ] Uninstall → prompt about data dir; choosing No keeps
      `%APPDATA%\Aether`; choosing Yes removes it.
- [ ] Silent install: `Aether-Setup-x.y.z.exe /S` completes and installs with
      defaults.
- [ ] Fresh `AETHER_HOME` first-run wizard completes end-to-end
      (`npm test` covers the server side: `tests/setupFirstRun.test.ts`).
- [ ] Kill the backend mid-boot (Simulate: end the Aether process) — the
      Electron error dialog appears, no silent half-window.
- [ ] Update resilience: hand-corrupt `%APPDATA%\Aether\settings.json`, start
      the app → recovery screen offers restore/reset/continue; original file
      is never silently overwritten (`tests/settingsRecovery.test.ts`).
