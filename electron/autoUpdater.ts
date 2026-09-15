/**
 * Auto-update groundwork — DORMANT by design for this release.
 *
 * electron-updater is installed and wired to the GitHub publish config in
 * electron-builder.json (provider github, owner kamyCodes, repo Aether),
 * but update checking NEVER runs unless an operator explicitly sets
 * AETHER_AUTO_UPDATE=1 in the environment. Default is OFF, declared here —
 * the same documented-default pattern the production audit accepted for the
 * gateway-guard diagnostics flag (AUDIT.md Section 6: "an operator
 * diagnostics control with a documented default ... it gates no
 * user-facing feature").
 *
 * Rationale for keeping it off: real auto-updates must not go live until the
 * installer-resilience work is fully tested (settings schema versioning,
 * safe-fail startup, migration backups) — an auto-update that swaps binaries
 * before data-migration guarantees exist risks corrupting user data dirs.
 *
 * When activation day comes:
 *   1. flip the default in DEFAULT_ENABLED below (or ship AETHER_AUTO_UPDATE=1),
 *   2. surface updateAvailable/downloaded events in the UI,
 *   3. verify staged release: vN installed → vN+1 on Releases → delta via .blockmap.
 *
 * Every consumer of the update feed must also keep the .blockmap attached to
 * releases — without it electron-updater falls back to full-package downloads.
 */
import { autoUpdater } from 'electron-updater';

const DEFAULT_ENABLED = false;
/** Operator switch — documented default: OFF (see header). */
const enabled = process.env.AETHER_AUTO_UPDATE === '1' || DEFAULT_ENABLED;

/** True once checkForUpdates has been kicked off (diagnostics/health). */
let started = false;

export function initAutoUpdate(log: (line: string) => void): void {
  if (!enabled) {
    log('[updater] disabled (set AETHER_AUTO_UPDATE=1 to enable update checks)');
    return;
  }
  if (started) return;
  started = true;

  // Log to stdout — visible in packaged runs the same way as [server] lines.
  autoUpdater.logger = {
    info: (m: unknown) => log(`[updater] ${String(m)}`),
    warn: (m: unknown) => log(`[updater] WARN ${String(m)}`),
    error: (m: unknown) => log(`[updater] ERROR ${String(m)}`),
    debug: (m: unknown) => log(`[updater] ${String(m)}`),
  };
  // Feed resolution comes from the build-time publish config
  // (electron-builder.json → https://github.com/kamyCodes/Aether/releases).
  autoUpdater.autoDownload = false; // always ask before pulling a new build
  autoUpdater.autoInstallOnAppQuit = false; // and never restart on its own

  autoUpdater.on('update-available', (i) => log(`[updater] update available: v${i.version}`));
  autoUpdater.on('update-not-available', () => log('[updater] up to date'));
  autoUpdater.on('error', (e) => log(`[updater] error: ${e.message}`));

  // Fire-and-forget: the release feed is checked, results are logged only.
  autoUpdater
    .checkForUpdates()
    .catch((e: unknown) => log(`[updater] check failed: ${e instanceof Error ? e.message : String(e)}`));
}

/** Diagnostics surface (future: /api/health field). */
export function autoUpdateEnabled(): boolean {
  return enabled;
}
