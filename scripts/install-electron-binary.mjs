/**
 * Manually install the Electron binary (download + extract + path.txt).
 * Works around environments where npm postinstall scripts are blocked.
 * Idempotent: skips when the binary is already present.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const electronDir = path.resolve('node_modules', 'electron');
const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
const version = pkg.version;
const distDir = path.join(electronDir, 'dist');
const exe = path.join(distDir, 'electron.exe');
const platform = process.platform === 'win32' ? 'win32' : process.platform;
const arch = process.arch;

if (fs.existsSync(exe)) {
  console.log(`electron ${version} binary already installed (${exe})`);
  process.exit(0);
}

console.log(`downloading electron ${version} (${platform}-${arch})…`);
const { downloadArtifact } = require('@electron/get');
const zipPath = await downloadArtifact({
  version,
  platform,
  arch,
  artifactName: 'electron',
});
console.log('zip:', zipPath);

fs.mkdirSync(distDir, { recursive: true });
console.log('extracting…');
// extract-zip (yauzl) silently no-ops under some file-write interception
// setups on Windows; Expand-Archive is the reliable path here.
if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' },
  );
} else {
  execSync(`unzip -o ${JSON.stringify(zipPath)} -d ${JSON.stringify(distDir)}`, {
    stdio: 'inherit',
  });
}
fs.writeFileSync(path.join(distDir, 'version'), version);
fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
console.log('OK —', exe);
