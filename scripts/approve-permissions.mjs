#!/usr/bin/env node
// Headless helper: polls GET /api/permissions/pending and auto-approves each
// pending request. Usage: AETHER_URL=... node scripts/approve-permissions.mjs [seconds]
import { configDefault, hostDefault } from './read-config.mjs';
const BASE = process.env.AETHER_URL ?? `http://${hostDefault()}:${configDefault('PORT')}/api`;
const seconds = Number(process.argv[2] ?? 90);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once() {
  const res = await fetch(`${BASE}/permissions/pending`);
  if (!res.ok) return 0;
  const list = await res.json();
  for (const id of list) {
    const r = await fetch(`${BASE}/permissions/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision: 'allow' }),
    });
    console.log(`approved ${id}: ${r.ok ? 'ok' : r.status}`);
  }
  return Array.isArray(list) ? list.length : 0;
}

const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  try { await once(); } catch { /* server restarting */ }
  await sleep(1500);
}
