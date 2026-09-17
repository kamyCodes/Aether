/**
 * Release notes generation (CHANGELOG.md).
 *
 * After a successful installer build, ensures CHANGELOG.md has an entry for
 * the current package.json version. The entry is created once per version
 * (re-running the build never duplicates or overwrites an existing entry) and
 * is pre-populated with artifacts + checksum data, ready for human editing.
 *
 * Detection of "what's new" is deliberately conservative: for tagged builds
 * (running inside the CI workflow on a v* tag) the changelog entry links to
 * the GitHub auto-generated release notes; for local builds it lists the
 * artifacts so nothing is invented.
 *
 * Wired into scripts/build-windows-installer.mjs (after checksums). A --dir
 * build has no installer and exits cleanly with a notice.
 *
 * Usage: node scripts/generate-release-notes.mjs [releaseDir]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve(process.argv[2] ?? 'release');
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const repoUrl = pkg.repository?.url?.replace(/\.git$/, '') ?? null;

const changelogPath = path.join(root, 'CHANGELOG.md');

const today = new Date().toISOString().slice(0, 10);

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Bullet list of changes derived from git history between the previous tag
 * and the tag for this version (falls back to last N commits on the current
 * branch when the tag doesn't exist yet, i.e. a local pre-release build).
 */
function gitChangeList() {
  const tag = `v${version}`;
  const tagExists = sh(`git rev-parse -q --verify "refs/tags/${tag}"`) !== null;
  if (tagExists) {
    // Release build: commits since the previous tag.
    const prev = sh('git describe --tags --abbrev=0 --match "v*" "refs/tags/${tag}^" 2>/dev/null');
    const range = prev ? `${prev}..${tag}` : tag;
    const log = sh(`git log ${range} --pretty=format:"- %s" -50`);
    if (log) return log;
  } else {
    // Local build: tag not cut yet — summarize recent work on this branch.
    const log = sh('git log --pretty=format:"- %s" -15');
    if (log) return log;
  }
  return null;
}

function buildEntry() {
  const lines = [`## [${version}] — ${today}`, ''];

  const changes = gitChangeList();
  if (changes) {
    lines.push('### Changes', '', ...changes.split('\n'), '');
  } else {
    lines.push('### Changes', '', '- (no git history available)', '');
  }

  // Artifact + checksum facts, straight from the release directory.
  const installers = fs
    .readdirSync(releaseDir)
    .filter((f) => new RegExp(`^Aether-Setup-${escapeRe(version)}\\.exe$`, 'i').test(f))
    .sort();
  if (installers.length > 0) {
    lines.push('### Artifacts', '');
    for (const name of installers) {
      const abs = path.join(releaseDir, name);
      const sizeMb = (fs.statSync(abs).size / (1024 * 1024)).toFixed(1);
      lines.push(`- \`${name}\` — ${sizeMb} MB`);
      const shaFile = `${abs}.sha256`;
      if (fs.existsSync(shaFile)) {
        const hash = fs.readFileSync(shaFile, 'utf8').split(/\s+/)[0].trim();
        if (hash) lines.push(`  - SHA-256: \`${hash}\``);
      }
    }
    lines.push('');
  }

  if (repoUrl) {
    lines.push(
      `**Full changelog:** [auto-generated release notes](${repoUrl}/releases/tag/v${version})`,
      '',
    );
  }
  return lines;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeChangelog() {
  const entry = buildEntry();
  let existing = '';
  if (fs.existsSync(changelogPath)) {
    existing = fs.readFileSync(changelogPath, 'utf8');
  } else {
    existing =
      '# Changelog\n\nAll notable changes to Aether are documented here. ' +
      'Each installer build adds an entry for its version; edit freely — ' +
      're-running the build never overwrites an existing entry.\n\n';
  }

  // Idempotent: one entry per version, ever. Insert new entries at the top
  // (after the header block) so newest is first, Keep a Changelog style.
  if (existing.includes(`## [${version}]`)) {
    console.log(`[release-notes] CHANGELOG.md already has an entry for ${version} — leaving it untouched`);
    return;
  }

  const headerEnd = existing.indexOf('\n## ');
  const header = headerEnd === -1 ? existing : existing.slice(0, headerEnd + 1);
  const rest = headerEnd === -1 ? '' : existing.slice(headerEnd + 1);
  fs.writeFileSync(changelogPath, header + entry.join('\n') + (rest ? '\n' + rest : ''), 'utf8');
  console.log(`[release-notes] added CHANGELOG.md entry for ${version}`);
}

if (!fs.existsSync(releaseDir)) {
  console.error(`[release-notes] release directory not found: ${releaseDir}`);
  process.exit(1);
}

const hasInstaller = fs
  .readdirSync(releaseDir)
  .some((f) => /^Aether-Setup-.+\.exe$/i.test(f));

if (!hasInstaller) {
  console.log('[release-notes] no installer artifacts (dir-only build?) — no changelog entry');
  process.exit(0);
}

writeChangelog();
