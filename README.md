# Aether

Aether is an AI development environment: a local IDE with an integrated autonomous coding agent. It pairs a React (Vite) front end with an Express/TypeScript back end that talks to an OpenAI-compatible model gateway ("OmniRoute"), executes agent tool calls behind a permission system, and streams everything to the UI over WebSockets.

## Requirements

- Node.js 22+
- A running OmniRoute-compatible gateway endpoint (models are discovered live from `/models`; no API key is required to explore, but agent runs need a working gateway)

## Getting started

```bash
npm install
npm run dev        # starts API server + Vite dev server together
```

The UI opens on the Vite port; the API server starts on the port from `server/config.ts` (override with `PORT` / `HOST` env vars; `AETHER_HOME` relocates per-user app data).

## Production build

```bash
npm run build      # compiles server (tsc) and bundles web (vite)
npm start          # build + serve from dist-server/
```

## Tests and checks

```bash
npm test           # node:test suite (regression, mockGuard, model catalog, audit gate)
npm run typecheck  # tsc for server + web, plus CSS token lint
npm run audit:gate # production-readiness search gate (see below)
```

## Architecture

```
src/            React UI (Vite)
  components/   Panels, editors, modals — one file per component
  lib/          Store (zustand), API client, dialogs, theming/glass effects
  utils/        Small shared helpers (icons, dates)
server/         Express API + agent runtime (TypeScript, ESM)
  config.ts     SINGLE source of truth for ports/hosts/derived paths
  agent.ts      Agent loop: messages → model → tool calls (permission-gated)
  permissions.ts  Allow/deny engine for tool use
  tools.ts      Agent tool surface (edit, shell, search, git)
  omni.ts       Gateway client (key masking — never logs full keys)
  mockGuard.ts  Refuses to run against mock/fake gateways in production
  index.ts      Wiring: HTTP routes, WebSocket fan-out, managers
shared/         Type definitions shared by client and server
scripts/        Operational scripts
  audit-gate.mjs        Ripgrep-based violation scanner (runs in CI)
  audit-allowlist.json  Justified exceptions for the gate
  dev-tools/            One-off audit/debug helpers (not part of CI)
Aether-Skill-Pack/  Markdown skill packs loadable by the agent
migrations/     Database migrations
docs/archive/   Historical audit reports and evidence
```

## The audit gate

`.github/workflows/audit-gate.yml` runs `scripts/audit-gate.mjs` plus typecheck and tests on every push across ubuntu and windows runners. The gate scans the tree for production-readiness violations (hardcoded paths/ports/hosts, secrets, mocks/stubs, dead feature flags, locale-dependent formatting) and fails on anything not allowlisted in `scripts/audit-allowlist.json`. Every allowlist entry carries a justification in `docs/archive/production-audit/AUDIT.md`.
