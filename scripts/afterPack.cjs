/**
 * electron-builder afterPack hook — reconcile the packaged node_modules
 * against the real production dependency tree.
 *
 * electron-builder's collector over-prunes with npm lockfileVersion 3
 * (observed: express → call-bound → call-bind-apply-helpers missing), which
 * crashes the backend with MODULE_NOT_FOUND on first boot. This hook walks
 * every production entry in package-lock.json and copies anything missing
 * from the dev tree into the packaged app. Idempotent; only additive.
 *
 * Config: "afterPack": "scripts/afterPack.cjs" in electron-builder.json.
 */
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const appOut = context.appOutDir; // e.g. release/win-unpacked
  const appNodeModules = path.join(appOut, 'resources', 'app', 'node_modules');
  const root = path.resolve(__dirname, '..');
  const devNodeModules = path.join(root, 'node_modules');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

  if (!fs.existsSync(appNodeModules)) {
    console.warn('[afterPack] no packaged node_modules — nothing to reconcile');
    return;
  }

  let copied = 0;
  let checked = 0;
  for (const [entry, meta] of Object.entries(lock.packages)) {
    if (!entry.startsWith('node_modules/')) continue;
    if (meta.dev || meta.devOptional || meta.optional) continue;
    checked += 1;
    const rel = entry.slice('node_modules/'.length);
    const dst = path.join(appNodeModules, rel);
    if (fs.existsSync(dst)) continue;
    const src = path.join(devNodeModules, rel);
    if (!fs.existsSync(src)) continue; // pruned locally too — nothing to copy
    fs.cpSync(src, dst, { recursive: true });
    copied += 1;
    if (copied <= 10) console.log(`[afterPack] restored missing pkg: ${rel}`);
  }
  console.log(`[afterPack] reconciled ${checked} production deps — copied ${copied} missing package(s)`);
};
