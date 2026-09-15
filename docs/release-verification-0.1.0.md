# Release verification report — v0.1.0 (2026-09-15)

Every claim below is backed by command output captured in this session. This is the
evidence bundle for the public release of `Aether-Setup-0.1.0.exe`.

## Section 1 — electron-builder publish config

**Status: VERIFIED (already in place, proven this session).**

- `electron-builder.json` contains the publish block targeting the real remote:
  ```json
  "publish": { "provider": "github", "owner": "kamyCodes", "repo": "Aether" }
  ```
- `git remote -v` (this session):
  ```
  origin  https://github.com/kamyCodes/Aether.git (fetch)
  origin  https://github.com/kamyCodes/Aether.git (push)
  ```
- Version-driven naming: `electron-builder.json` sets
  `"artifactName": "Aether-Setup-${version}.${ext}"` in both `win` and `nsis` blocks.
- Fresh end-to-end build this session (`npm run package:win`). The **actual** filename
  produced, from electron-builder's own log:
  ```
  • building        target=nsis file=release\Aether-Setup-0.1.0.exe archs=x64
  ```
  and from `ls -la` afterward: `release/Aether-Setup-0.1.0.exe` (135,501,490 bytes,
  129.2 MB), mtime 2026-09-15 22:12:05 — no manual renaming anywhere.

## Section 2 — Checksum generation, automated

**Status: VERIFIED.**

- `scripts/generate-checksum.mjs` computes SHA-256 over every `Aether-Setup-*.exe`
  in `release/`, writes a sibling `.sha256` in `sha256sum -c` format, and **fails the
  build** if the artifact name doesn't carry `package.json`'s version.
- Wired into `scripts/build-windows-installer.mjs` as a mandatory step after
  electron-builder (`step('sha256 checksums')`) — it cannot be forgotten, and the CI
  workflow additionally asserts the `.sha256` exists before attaching artifacts.
- Build output this session:
  ```
  === sha256 checksums ===
  [checksum] Aether-Setup-0.1.0.exe (129.2 MB)
  [checksum]   sha256: ee5f161cce8342198c0c8e07656ccd690c1c124d12873ab25f539ca409da9d97
  [checksum]   wrote:  Aether-Setup-0.1.0.exe.sha256
  ```
- Independent cross-check #1 (GNU coreutils):
  ```
  $ sha256sum -c Aether-Setup-0.1.0.exe.sha256
  Aether-Setup-0.1.0.exe: OK
  ```
- Independent cross-check #2 (Windows-native):
  ```
  $ certutil -hashfile Aether-Setup-0.1.0.exe SHA256
  SHA256 hash of Aether-Setup-0.1.0.exe:
  ee5f161cce8342198c0c8e07656ccd690c1c124d12873ab25f539ca409da9d97
  CertUtil: -hashfile command completed successfully.
  ```
- On-disk record: `ee5f161cce8342198c0c8e07656ccd690c1c124d12873ab25f539ca409da9d97  Aether-Setup-0.1.0.exe`

Three independent computations (build script, sha256sum, certutil) agree.

## Section 3 — Download page content

**Status: DONE — generated, not hand-placed.**

- `docs/download-snippet-0.1.0.html` — drop-in `<section>` markup.
- `docs/download-snippet-0.1.0.md` — Markdown equivalent.
- Both embed the exact verified checksum and the `releases/latest/download/` URL
  pattern, so the site never needs touching per-release beyond swapping version,
  checksum, and size (noted in file headers).
- Changelog line is written for end users (first public release; reliability framing),
  not a dev changelog, per the prompt.

## Section 4 — Release feed groundwork for auto-updates (prep only)

**Status: VERIFIED — wired but dormant.**

- `electron-updater@6.8.9` is in `package.json` dependencies and confirmed inside the
  packaged bundle:
  ```
  $ node -e "console.log(require('./release/win-unpacked/resources/app/node_modules/electron-updater/package.json').version)"
  6.8.9
  ```
- `electron/autoUpdater.ts` reads the same publish config from
  `electron-builder.json` (provider github → kamyCodes/Aether releases feed).
- Update checking is **disabled by default**: it runs only when
  `AETHER_AUTO_UPDATE=1` is set in the environment. The disabled notice shipped in
  the packaged bundle (grep over the real artifact):
  ```
  $ grep -c 'AETHER_AUTO_UPDATE' release/win-unpacked/resources/app/electron/dist/main.cjs
  2
  $ grep -o 'disabled (set AETHER_AUTO_UPDATE=1 to enable update checks)' release/win-unpacked/resources/app/electron/dist/main.cjs
  disabled (set AETHER_AUTO_UPDATE=1 to enable update checks)
  ```
  Even when enabled, `autoDownload` and `autoInstallOnAppQuit` are false — the app
  asks before pulling anything and never restarts itself. Activation stays blocked
  until the installer-resilience work (schema versioning, safe-fail startup,
  migration backups) is fully tested, per the plan in `electron/autoUpdater.ts`.
- Delta-update prerequisites ship: the build log shows
  `• building block map  blockMapFile=release\Aether-Setup-0.1.0.exe.blockmap`,
  the file exists on disk (139,099 bytes), `latest.yml` carries `version: 0.1.0`
  with the exe's sha512, and the CI workflow uploads/attaches both.

## Section 5 — Pre-publish verification gate

### 5.1 Version consistency — PASS

Five surfaces, one version:
```
package.json          → "version": "0.1.0"
shared/version.ts     → APP_VERSION = '0.1.0'
artifact filename     → release/Aether-Setup-0.1.0.exe
checksum record       → ee5f161cce8342198c0c8e07656ccd690c1c124d12873ab25f539ca409da9d97  Aether-Setup-0.1.0.exe
latest.yml            → version: 0.1.0
```
The download snippet (docs/download-snippet-0.1.0.{html,md}) references 0.1.0 in
the URL, filename, and verify command, and embeds the same checksum.

### 5.2 Fresh smoke test against the final artifact — PASS

Re-run this session against the exact bits being published (`win-unpacked` from the
same build that produced the installer), isolated `AETHER_HOME` sandbox:
```
  ✓ backend listener — 127.0.0.1:60387
  ✓ GET /api/health
  ✓ version handshake present — 0.1.0
  ✓ fresh install: setup incomplete
  ✓ data dir defaults to the sandbox
  ✓ data dir writable probe
  ✓ omni default endpoint present
  ✓ GET /api/settings
  ✓ PUT /api/settings round-trip
  ✓ settings schema version stamped on disk
  ✓ frontend bundle served

SMOKE: 11/11 passed
```

### 5.3 Audit gate — CLEAN

```
PASS S1.windows-users-path: 0 matches
... (all 17 checks)
AUDIT GATE: CLEAN
```
Full test suite in the same session: **50/50 passed**.

### 5.4 What a first-time downloader will see (unsigned build)

Kamy should expect the following before the link goes public:

1. **Download** from the GitHub Release page (or the direct link). No warnings at
   this stage; the browser may show its generic "this file type can harm your
   computer" footer — normal for any `.exe`.
2. **SmartScreen warning on first launch.** Because the installer is unsigned, the
   first install shows the blue "Windows protected your PC" dialog:
   - It reads "Unknown publisher" — this is expected, not a virus indicator.
   - The user must click **More info**, which reveals a **Run anyway** button.
   - There is no way to remove this without a code-signing certificate (OV from
     ~$200/yr, or EV which removes the warning immediately but needs extended
     vetting). This is the single biggest friction point for strangers.
3. **Installer flow:** NSIS with a license page, per-user install (no admin needed,
   `requestedExecutionLevel: asInvoker`), choice of install directory, desktop and
   Start Menu shortcuts.
4. **First run:** Aether's own setup wizard (backend on a loopback port, data dir
   under `%APPDATA%\Aether`, settings defaults). The smoke test proves this path on
   a fresh sandbox.
5. **Optional friction note:** some antivirus products heuristically flag unsigned
   installers; the published SHA-256 gives users a way to confirm the file they
   have is the one Kamy shipped.

## Deliverables index

- `electron-builder.json` — publish block (pre-existing, verified)
- `scripts/generate-checksum.mjs` — wired into `scripts/build-windows-installer.mjs`
- `docs/download-snippet-0.1.0.html` / `.md` — ready to paste into the site
- `.github/workflows/windows-installer.yml` — checksum steps + `.sha256` uploaded
  and attached to Releases
- `electron/autoUpdater.ts` — dormant update groundwork

## Remaining human steps (cannot be done by the agent)

1. Push these changes and tag `v0.1.0` — CI builds, smoke-tests, re-hashes, and
   attaches the exe + blockmap + sha256 + latest.yml to the GitHub Release.
2. Confirm the Release is public (not draft) so `releases/latest/download/` resolves.
3. Paste the download snippet into www.kamy.name.ng.
4. After publishing, download the exe **from the live URL** once and re-run
   `certutil -hashfile` to prove the served bytes match the published checksum.
