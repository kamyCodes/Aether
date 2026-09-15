/**
 * Post-build checksum generation (release gate, Section 2).
 *
 * Computes SHA-256 for every NSIS installer artifact in release/ and writes
 * a sibling `<file>.exe.sha256` in `sha256sum -c` format (hash + two spaces
 * + bare filename), so verification works with both:
 *
 *   certutil -hashfile Aether-Setup-<version>.exe SHA256   (Windows built-in)
 *   sha256sum -c Aether-Setup-<version>.exe.sha256         (GNU coreutils)
 *
 * Guards the filename against version drift: an installer whose name does
 * not carry package.json's version fails the build instead of shipping.
 *
 * Wired into scripts/build-windows-installer.mjs (after electron-builder);
 * a --dir build has no installer and exits cleanly with a notice.
 *
 * Usage: node scripts/generate-checksum.mjs [releaseDir]
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve(process.argv[2] ?? 'release');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expectedVersion = pkg.version;

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

if (!fs.existsSync(releaseDir)) {
  console.error(`[checksum] release directory not found: ${releaseDir}`);
  process.exit(1);
}

const installers = fs
  .readdirSync(releaseDir)
  .filter((f) => /^Aether-Setup-.+\.exe$/i.test(f))
  .sort();

if (installers.length === 0) {
  console.log('[checksum] no installer artifacts (dir-only build?) — nothing to hash');
  process.exit(0);
}

let failed = false;
for (const name of installers) {
  // Filename must be version-exact or the "latest" download URL pattern and
  // the checksum record describe different files.
  if (!name.toLowerCase().includes(`-${expectedVersion}.exe`)) {
    console.error(
      `[checksum] FAIL: ${name} does not match package.json version ${expectedVersion} — bump package.json/shared/version.ts and rebuild`,
    );
    failed = true;
    continue;
  }
  const abs = path.join(releaseDir, name);
  const hash = await sha256(abs);
  const outFile = `${abs}.sha256`;
  fs.writeFileSync(outFile, `${hash}  ${name}\n`, 'utf8');
  const sizeMb = (fs.statSync(abs).size / (1024 * 1024)).toFixed(1);
  console.log(`[checksum] ${name} (${sizeMb} MB)`);
  console.log(`[checksum]   sha256: ${hash}`);
  console.log(`[checksum]   wrote:  ${path.basename(outFile)}`);
}

process.exit(failed ? 1 : 0);
