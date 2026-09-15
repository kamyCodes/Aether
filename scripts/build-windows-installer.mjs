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

step('done — output in release/');
console.log('Installer:  release/Aether-Setup-<version>.exe');
console.log('Blockmap:   release/Aether-Setup-<version>.exe.blockmap (for future delta updates)');
console.log('Checksum:   release/Aether-Setup-<version>.exe.sha256 (publish this beside the exe)');
