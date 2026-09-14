# Contributing to Aether

## Getting set up

```bash
npm install
npm run dev
npm test
```

See `README.md` for the full script list.

## Before you push

Run all three checks locally — CI (`audit-gate.yml`) runs the same set on ubuntu and windows:

```bash
node scripts/audit-gate.mjs .   # search gate — fails on non-allowlisted violations
npm run typecheck               # tsc (server + web) + CSS token lint
npm test
```

The gate scans every commit for hardcoded paths/ports/secrets, leftover mocks and stubs, dead feature flags, and locale-dependent code. If it flags something in your change, fix it — don't add an allowlist entry unless the match is genuinely justified, and if so, document the justification in `docs/archive/production-audit/AUDIT.md` alongside the allowlist entry in `scripts/audit-allowlist.json`.

## Conventions

- **TypeScript everywhere**, ESM imports with explicit extensions on the server (`./foo.js`), extensionless relative imports in the web app.
- **Components**: one React component per file in `src/components/`, named export matching the file name.
- **Server modules**: one responsibility per file under `server/`, each opening with a short "why this file exists" header comment.
- **Config**: ports, hosts, and paths come from `server/config.ts` only. Never hardcode `localhost`, port numbers, or absolute paths elsewhere — the gate will catch it.
- **Secrets**: never commit keys. API keys resolve from settings or `OMNIROUTE_API_KEY` and are masked in logs (`server/omni.ts`).

## Commits and branches

- Branches: short kebab-case topic branches (`fix/terminal-resize`, `feat/plan-approval`).
- Commits: imperative subject line summarizing intent ("Persist permission rules across restarts"), body explaining the why when non-obvious.

## Design tokens

UI styling uses the token system in `src/styles.css`, enforced by `npm run lint:css`. Hardcoded radii/spacings need a waiver in that linter's rules, not an inline value.
