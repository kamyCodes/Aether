import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from './config.js';

const LEGACY_DIR = path.join(os.homedir(), '.omnicoder');
export { DATA_DIR };

// One-time migration from the previous app name so existing workspaces,
// settings, skills, and checkpoints carry over to ~/.aether.
// Copy-based (rename can fail on Windows when files are locked); any
// entries that already exist in the target are left untouched.
if (fs.existsSync(LEGACY_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const entry of fs.readdirSync(LEGACY_DIR)) {
      const src = path.join(LEGACY_DIR, entry);
      const dst = path.join(DATA_DIR, entry);
      const needsCopy =
        !fs.existsSync(dst) ||
        (fs.statSync(dst).isFile() && fs.statSync(dst).size === 0); // e.g. interrupted earlier migration
      if (needsCopy) fs.cpSync(src, dst, { recursive: true });
    }
    // Adopt the Aether brand accent (redesign indigo) as part of the rebrand.
    const settingsFile = path.join(DATA_DIR, 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as { ui?: { accent?: string } };
    if (parsed.ui && parsed.ui.accent === '#7c9cff') {
      parsed.ui.accent = '#6E62E5';
      fs.writeFileSync(settingsFile, JSON.stringify(parsed, null, 2));
    }
  } catch { /* run with whatever is readable */ }
}
