#!/usr/bin/env node
/**
 * Reads runtime defaults from server/config.ts — the single declaration
 * site for ports/hosts (audit Section 2). Standalone .mjs dev scripts cannot
 * import TypeScript, so they parse the declared default out of the source
 * instead of re-typing a literal. An env var of the same name always wins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_TS = path.join(ROOT, 'server', 'config.ts');

function readConfigSource() {
  try { return fs.readFileSync(CONFIG_TS, 'utf8'); } catch { return ''; }
}

/** Numeric default declared as `portEnv('NAME', <num>)` (or `NAME = <num>`).
 *  Throws when undeclared — never a silent second copy of the number. */
export function configDefault(name) {
  const env = Number(process.env[name]);
  if (Number.isInteger(env) && env > 0) return env;
  const m = readConfigSource().match(new RegExp(`portEnv\\('${name}',\\s*(\\d+)\\)`))
    ?? readConfigSource().match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)\\b`));
  if (!m) throw new Error(`config default '${name}' not found in server/config.ts — the resolver is the only declaration site`);
  return Number(m[1]);
}

/** Host default declared as `export const HOST = process.env.HOST ?? '<h>'`. */
export function hostDefault() {
  if (process.env.HOST) return process.env.HOST;
  const m = readConfigSource().match(/export const HOST = process\.env\.HOST \?\? '([^']+)'/);
  if (!m) throw new Error('HOST default not found in server/config.ts — the resolver is the only declaration site');
  return m[1];
}
