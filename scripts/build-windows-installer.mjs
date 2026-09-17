/**
 * Windows packaging: compile server (tsc) + web (vite) + electron main
 * (esbuild), then hand the tree to electron-builder's NSIS target.
 * Usage: node scripts/build-windows-installer.mjs [--dir]  (--dir = unpacked only, faster smoke test)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const step = (m) => console.log(`\n=== ${m} ===`);

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

step('archive previous installers');
// Before release/ is wiped by the new build, move every installer artifact
// from a previous version into archives/ so old installers are kept as
// previous versions (release/ itself stays gitignored and single-version).
archivePreviousInstallers();

step('clean');
for (const d of ['dist', 'dist-server', 'electron/dist']) {
  fs.rmSync(path.join(root, d), { recursive: true, force: true });
}

step('build server (tsc)');
run('npm run build:server');

step('build web (vite)');
run('npm run build:web');

step('build electron main (esbuild)');
fs.mkdirSync(path.join(root, 'electron/dist'), { recursive: true });
// .cjs: package.json declares "type": "module", so the CJS bundle must not
// use a .js extension or Node/Electron treats it as ESM and dies on require().
// electron-updater stays external: it resolves from packaged node_modules and
// bundles poorly (dynamic requires).
run(
  'npx esbuild electron/main.ts --bundle --platform=node --external:electron ' +
    '--external:electron-updater ' +
    '--outfile=electron/dist/main.cjs --format=cjs',
);

step('installer icon');
run('node scripts/make-icon.mjs');

step('electron-builder NSIS');
// electron-builder packs the app from package.json "files" + buildResources.
// The publish block in electron-builder.json only activates with explicit
// --publish flags or CI tag detection — a plain local build never uploads.
const extra = process.argv.includes('--dir') ? ' --dir' : '';
run(`npx electron-builder --win nsis${extra}`);

step('sha256 checksums');
run('node scripts/generate-checksum.mjs');

step('release notes');
run('node scripts/generate-release-notes.mjs');

step('done — output in release/');
console.log('Installer:  release/Aether-Setup-<version>.exe');
console.log('Blockmap:   release/Aether-Setup-<version>.exe.blockmap (for future delta updates)');
console.log('Checksum:   release/Aether-Setup-<version>.exe.sha256 (publish this beside the exe)');
console.log('Changelog:  CHANGELOG.md (entry added/verified for this version)');
console.log('Archives:   archives/ (previous-version installers kept from earlier builds)');

/**
 * Move installer artifacts belonging to any version other than the current
 * package.json version from release/ into archives/<version>/. The new build
 * then starts from a clean release/ containing only the current version.
 */
function archivePreviousInstallers() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const releaseDir = path.join(root, 'release');
  if (!fs.existsSync(releaseDir)) return;

  const current = new RegExp(`^Aether-Setup-${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`, 'i');
  const archived = new Set();
  for (const name of fs.readdirSync(releaseDir)) {
    // Match the base installer name plus any sibling suffix (.exe, .blockmap,
    // .sha256) so all artifacts of a version group together.
    const m = name.match(/^(Aether-Setup-.+?\.exe)(?:\.blockmap|\.sha256)?$/i);
    if (!m) continue;
    if (current.test(name)) continue; // current version stays in release/

    const prevVersion = m[1].match(/^Aether-Setup-(.+)\.exe$/i)?.[1];
    if (!prevVersion) continue;
    const destDir = path.join(root, 'archives', prevVersion);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(path.join(releaseDir, name), path.join(destDir, name));
    archived.add(prevVersion);
  }
  // latest.yml / builder-debug.yml / win-unpacked are always stale after a
  // rebuild, so they are simply wiped by the clean step below.
  if (archived.size > 0) {
    for (const v of [...archived].sort()) {
      const files = fs
        .readdirSync(path.join(root, 'archives', v))
        .map((f) => `${f} (${(fs.statSync(path.join(root, 'archives', v, f)).size / (1024 * 1024)).toFixed(1)} MB)`)
        .join(', ');
      console.log(`[archive] kept previous installer: archives/v${v}/ — ${files}`);
    }
  } else {
    console.log('[archive] no previous-version installers to keep');
  }
}
