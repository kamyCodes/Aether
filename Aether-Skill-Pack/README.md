# Aether Skill Pack — Organized Index (75 skills)

Machine-readable index: `skills-manifest.json`. Load skills programmatically with `src/utils/skillsLoader.ts` (filter by category or pick ids; concatenates full markdown into task context).

Two formats live here: `agent-extra-skills/NN-*.md` (Trigger / What it does / Process / Output format / Guardrails) and `skills/<name>/SKILL.md` (frontmatter + guidance bullets). Agent role docs (`agents/`) and the constitution (`AETHER.md`) are not skills and are excluded.

## UI (7)

- **Design-Token Enforcer** (`11-design-token-enforcer`) — Scans components for hardcoded colors, spacing, and font values and rewrites them against the project's existing design tokens/theme variables.
- **Motion/Interaction Reviewer** (`12-motion-interaction-reviewer`) — Flags missing hover/focus/active/disabled states and inconsistent transition timing, and proposes a concrete motion spec instead of just noting what's missing.
- **Empty-State / Edge-State Generator** (`16-empty-state-generator`) — Auto-generates the loading, empty, error, and overflow states for a data-driven component — the states usually forgotten until QA finds them.
- **Latency-Aware UI Skeleton Builder** (`17-latency-aware-skeleton-builder`) — Generates skeleton/shimmer states si
- **Multi-Theme Consistency Checker** (`19-multi-theme-consistency-checker`) — Verifies a new or changed component renders correctly across every supported theme variant, not just the one it was built/tested in.
- **Frontend Engineering** (`frontend-engineering`) — Build production-quality web interfaces and frontend systems.
- **Ui Design** (`ui-design`) — Produce polished, coherent product interfaces instead of generic AI-generated UI.

## Design (2)

- **Design-to-Code Diff Checker** (`18-design-to-code-diff-checker`) — Compares the shipped component against the provided design reference (spacing, type scale, colors, si
- **Apple HIG Design Skill** (`22-apple-hig-design`) — Applies Apple's Human Interface Guidelines: correct spacing/type scale, native navigation and gesture patterns, proper use of materials/blur/depth, and platform-appropriate controls — flags anything that reads as non-native.

## Verification (12)

- **XML/Document-Structure Validator** (`08-xml-document-structure-validator`) — Validates a document against its schema (XSD/DTD/RelaxNG) and translates raw parser errors into plain-language explanations with a suggested fix.
- **Accessibility Auditor (with fix-patches)** (`13-accessibility-auditor`) — Runs axe-core-style checks conceptually against the rendered/markup output and generates an actual patch (aria labels, contrast fixes, focus order) instead of just a report.
- **Component API Critic** (`14-component-api-critic`) — Reviews new component props against the conventions already established elsewhere in the library (naming, boolean vs.
- **i18n/Localization Completeness Checker** (`25-i18n-localization-completeness-checker`) — Diffs translation files against the base locale, flags missing keys, unused keys, and raw user-facing strings that were never wrapped in the translation function.
- **Dead Code & Unused Export Finder** (`26-dead-code-unused-export-finder`) — Traces the full import graph across the codebase to find exported functions/components/routes that nothing references anymore — a whole-codebase audit, distinct from pre-change impact analysis.
- **Error/Logging Consistency Enforcer** (`33-error-logging-consistency-enforcer`) — Checks that errors are logged with a consistent structure (level, context fields, stack trace inclusion) across the codebase, instead of every file inventing its own shape.
- **Continuous Quality Gate** (`42-continuous-quality-gate`) — Runs a fixed checklist before calling anything complete — tests, lint, types, no console warnings/errors, basic accessibility pass — and reports gate status explicitly rather than declaring completion on vibes.
- **Autonomous Adversarial Reviewer** (`43-autonomous-adversarial-reviewer`) — Reviews its own generated diff the way a strict senior engineer would before presenting it — catching the issues a first pass reliably misses, rather than presenting first-draft output as final.
- **Accessibility** (`accessibility`) — Audit and implement accessible interfaces.
- **Code Review** (`code-review`) — Perform a rigorous self-review or review another change.
- **Quality Gates** (`quality-gates`) — Apply Aether's final quality gate before task completion.
- **Security** (`security`) — Identify and prevent common application security problems.

## Testing (6)

- **Test Gap Finder** (`04-test-gap-finder`) — Runs (or reads) coverage data and generates tests specifically for uncovered branches — not a blanket regeneration of the whole test suite.
- **Prompt/Response Regression Harness** (`05-prompt-response-regression-harness`) — Snapshots prompts and their outputs, then flags when the same input starts producing a meaningfully different output after a change.
- **Performance Regression Sentinel** (`10-performance-regression-sentinel`) — Benchmarks the affected code path before and after a change and flags if latency/memory crosses a set threshold — especially useful around ML/NLP inference calls.
- **Visual Regression Diffing Agent** (`15-visual-regression-diffing-agent`) — Compares before/after rendered output of a component at multiple breakpoints and highlights actual pixel-level/layout differences, not just "the code changed."
- **Flaky Test Detector** (`28-flaky-test-detector`) — Reruns the suite/test multiple times to isolate intermittent failures, then diagnoses the likely cause instead of just labeling it "flaky" and moving on.
- **Testing** (`testing`) — Design and execute reliable tests for software changes.

## Build (12)

- **Contract-First API Scaffolder** (`01-contract-first-api-scaffolder`) — Generates backend route handlers + validation models AND the matching frontend client types/hooks in a single pass, so the two never drift out of sync.
- **Migration-Safe Schema Editor** (`03-migration-safe-schema-editor`) — Diffs the proposed model change against the current schema and generates the matching migration file (Alembic/Prisma/Django/etc., detect from repo) plus a working rollback.
- **Code Complexity Reducer** (`21-code-complexity-reducer`) — Scans for cyclomatic complexity, deep nesting, and long parameter lists, then proposes concrete refactors ranked by complexity-reduction-per-line-changed — not style nitpicks.
- **Full-App-From-Prompt Builder** (`35-full-app-from-prompt-builder`) — Takes a plain-language product description and scaffolds a complete, architecturally coherent app in one pass — frontend, backend, data model, auth — with a written rationale for each structural decision, not a pile of disconnected files.
- **Self-Healing Build Loop** (`36-self-healing-build-loop`) — After every generated change, runs build/lint/test, parses the actual error output, and iterates fixes autonomously up to a capped attempt count — then reports plainly what it couldn't resolve, instead of claiming success it didn't verify.
- **Prototype-to-Production Hardener** (`44-prototype-to-production-hardener`) — Systematically upgrades a prototype — error handling, input validation, security basics, env/config management — and lists exactly what was hardened and what's still a known shortcut.
- **Api Engineering** (`api-engineering`) — Design, implement, and validate robust APIs.
- **Core Engineering** (`core-engineering`) — Core engineering standards for every Aether coding task.
- **Database** (`database`) — Safely work with schemas, queries, indexes, transactions, and persistence.
- **Implementation** (`implementation`) — Implement production-quality changes with minimal, targeted edits.
- **Migrations** (`migrations`) — Safely design and execute database or data migrations.
- **Refactoring** (`refactoring`) — Safely improve code structure without changing intended behavior.

## Debugging (7)

- **Dependency-Graph Impact Analyzer** (`02-dependency-graph-impact-analyzer`) — Statically traces every module, route, test, and caller that touches the function/class being changed, and produces a blast-radius report before any edit is made.
- **Narrative-State Debugger for Agentic UIs** (`20-narrative-state-debugger`) — Traces a session's UI state transitions against the underlying agent/session state and flags where they've desynced — a common bug class in AI-driven interfaces where the UI shows a stale step, wrong status, or mismatched output.
- **Autonomous Root-Cause Debugger** (`38-autonomous-root-cause-debugger`) — Forms hypotheses, adds targeted instrumentation, reproduces the failure, and narrows to root cause before writing any fix — no shotgun patching based on a guess.
- **Change Impact Analysis** (`change-impact-analysis`) — Identify dependencies and regression risks before significant changes.
- **Debugging** (`debugging`) — Diagnose bugs through evidence and root-cause analysis.
- **Incident Recovery** (`incident-recovery`) — Recover safely from failed commands, broken builds, regressions, and partial changes.
- **Performance** (`performance`) — Diagnose and improve application performance using evidence.

## Ops (15)

- **Env/Secrets Drift Checker** (`06-env-secrets-drift-checker`) — Diffs `.env.example` (or equivalent) against what the code actually reads (`os.getenv`, `process.env`, config classes) and against deployment platform env vars if accessible, flagging missing or unused keys before runtime failure.
- **Doc-Sync Skill** (`07-doc-sync`) — Detects signature/behavior changes and updates the corresponding README section, docstring, and API reference in the same change, so docs don't silently rot.
- **Secrets/Credential Leak Scanner** (`24-secrets-credential-leak-scanner`) — Scans working diffs AND git history (not just `.env` files) for hardcoded API keys, tokens, and credentials, matching known key-format patterns (AWS, Stripe, OpenAI, GitHub, JWTs, etc.) before a push.
- **Bundle Size Auditor** (`27-bundle-size-auditor`) — Flags what a new dependency/import actually costs in bundle si
- **Feature Flag Lifecycle Manager** (`29-feature-flag-lifecycle-manager`) — Tracks flags from creation to cleanup: flags ones at 100% rollout for a while that should be deleted, and warns when new code adds a permanent dependency on a supposedly-temporary flag.
- **Changelog/Release Notes Generator** (`30-changelog-release-notes-generator`) — Reads merged commits/PRs since the last tag and drafts categori
- **API Rate-Limit & Backoff Auditor** (`31-api-rate-limit-backoff-auditor`) — Checks external API calls for missing retry/backoff logic, flags calls with no rate-limit handling, and generates an exponential-backoff wrapper matching the target API's documented limits.
- **Config Parity Across Environments Checker** (`32-config-parity-checker`) — Compares dev/staging/prod config (feature flags, timeouts, limits, resource si
- **Commit Message Quality Skill** (`34-commit-message-quality-skill`) — Reviews staged changes and drafts a commit message matching the repo's actual convention (conventional commits, ticket-prefix style, imperative one-liners, etc.), inferred from git log history — not a generic template.
- **Dependency Management** (`dependency-management`) — Safely select, add, update, and remove dependencies.
- **Documentation** (`documentation`) — Create and maintain accurate developer and user documentation.
- **Git Workflow** (`git-workflow`) — Safely manage Git changes during agent-assisted development.
- **Observability** (`observability`) — Improve logging, metrics, tracing, diagnostics, and operational visibility.
- **Release Engineering** (`release-engineering`) — Prepare software changes for build, release, and deployment.
- **Terminal Safety** (`terminal-safety`) — Safely execute shell commands and system operations.

## Orchestration (9)

- **Fast Task Completion Mode** (`23-fast-task-completion-mode`) — A lean execution mode for well-scoped tasks: skips exploratory discussion, batches reads/edits instead of doing them one at a time, defaults to the most conventional implementation without presenting multiple options, and only pauses for ge
- **Multi-Agent Task Orchestrator** (`37-multi-agent-task-orchestrator`) — Breaks a large task into explicit roles — planner, implementer, reviewer, tester — with defined handoff contracts between them, so a big task doesn't collapse under one undifferentiated context pass.
- **Live Architecture Decision Recorder** (`39-live-architecture-decision-recorder`) — Automatically writes a lightweight ADR (what was decided, why, alternatives considered) at each significant technical fork, so decisions and their reasoning aren't lost by the next session.
- **Spec-to-Build-Plan Converter** (`40-spec-to-build-plan-converter`) — Converts a loose product idea into a structured plan — data model, user flows, milestone sequence — before any code gets written, front-loading planning the way high-end app-builder tools do.
- **Agent Coordination** (`agent-coordination`) — Coordinate specialized Aether agents without duplicating work.
- **Architecture** (`architecture`) — Analyze and design maintainable software architecture.
- **Autonomous Task Execution** (`autonomous-task-execution`) — Own a software task from request through implementation and verification.
- **Planning** (`planning`) — Convert software requests into actionable implementation plans.
- **Task Memory** (`task-memory`) — Maintain useful task context without polluting persistent memory.

## Import (4)

- **Cross-Repo Context Linker** (`09-cross-repo-context-linker`) — Pulls relevant context (interfaces, shared types, config contracts) from sibling repos/modules without the user manually pasting files in.
- **Multimodal Spec Binder** (`41-multimodal-spec-binder`) — Treats pasted images as first-class spec input, cross-referenced directly against the actual code — not as loose context that gets mentioned once and then ignored.
- **Repo Exploration** (`repo-exploration`) — Efficiently understand an unfamiliar repository before implementation.
- **Research** (`research`) — Research technical questions using authoritative evidence before making implementation decisions.

## Output Style (1)

- **Caveman Compressed Mode** (`45-caveman-compressed-mode`) — Rewrites the agent's own output into stripped-down, filler-free technical prose — dropping hedges, pleasantries, restated context, and throat-clearing — while preserving exact technical accuracy.
