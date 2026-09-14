/**
 * Generates Aether-Skill-Pack/skills-manifest.json and README.md by parsing
 * every skill markdown file. Re-runnable: node scripts/generate-skills-manifest.mjs
 *
 * Two skill families live in the pack:
 *  - skills/<name>/SKILL.md  — frontmatter style (name/description), no Trigger section
 *  - agent-extra-skills/NN-name.md — Trigger / What it does / Process / Output format / Guardrails
 * Agents (agents/*.md) and AETHER.md are constitution/role docs, NOT skills — excluded.
 * Skill file contents are never modified — read-only parsing.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = join(ROOT, 'Aether-Skill-Pack');
const EXTRA = join(PACK, 'agent-extra-skills');
const CORE = join(PACK, 'skills');

// ---------- parsing helpers ----------

/** Extract a "## Section" body from markdown (up to the next ## or EOF). */
function section(md, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'mi');
  return md.match(re)?.[1]?.trim() ?? '';
}

function h1(md) {
  return md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
}

/** Condense a Trigger section (bullets) into a short phrase list. */
function condenseTrigger(triggerMd) {
  if (!triggerMd) return '';
  const bullets = triggerMd
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  const joined = bullets.slice(0, 2).join(' ').replace(/\s+/g, ' ');
  return joined.length > 180 ? `${joined.slice(0, 177)}…` : joined;
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : clean).slice(0, 240);
}

// ---------- categorization ----------
// Primary-trigger based. Where two categories fit, the second goes in tags.

const EXTRA_CATEGORY = {
  '01-contract-first-api-scaffolder': ['build', ['api', 'scaffolding', 'codegen', 'contracts']],
  '02-dependency-graph-impact-analyzer': [
    'debugging',
    ['impact-analysis', 'refactoring', 'dependencies', 'risk'],
  ],
  '03-migration-safe-schema-editor': ['build', ['migrations', 'database', 'schema', 'orm']],
  '04-test-gap-finder': ['testing', ['coverage', 'test-generation', 'gaps']],
  '05-prompt-response-regression-harness': ['testing', ['regression', 'llm', 'prompts', 'harness']],
  '06-env-secrets-drift-checker': ['ops', ['env', 'deploy', 'secrets', 'config']],
  '07-doc-sync': ['ops', ['documentation', 'api-docs', 'sync']],
  '08-xml-document-structure-validator': [
    'verification',
    ['xml', 'validation', 'documents', 'xsd'],
  ],
  '09-cross-repo-context-linker': ['import', ['cross-repo', 'context', 'multi-service', 'linking']],
  '10-performance-regression-sentinel': [
    'testing',
    ['performance', 'regression', 'benchmark', 'hot-paths'],
  ],
  '11-design-token-enforcer': ['ui', ['design-tokens', 'theming', 'styling', 'consistency']],
  '12-motion-interaction-reviewer': [
    'ui',
    ['interaction-states', 'motion', 'transitions', 'polish'],
  ],
  '13-accessibility-auditor': ['verification', ['accessibility', 'a11y', 'aria', 'contrast'], 'ui'],
  '14-component-api-critic': [
    'verification',
    ['components', 'api-design', 'conventions', 'review'],
    'ui',
  ],
  '15-visual-regression-diffing-agent': [
    'testing',
    ['visual-regression', 'breakpoints', 'diffing'],
  ],
  '16-empty-state-generator': ['ui', ['edge-states', 'loading', 'error-states', 'components']],
  '17-latency-aware-skeleton-builder': ['ui', ['skeletons', 'loading', 'latency', 'ux']],
  '18-design-to-code-diff-checker': [
    'design',
    ['design-to-code', 'fidelity', 'spec-matching'],
    'ui',
  ],
  '19-multi-theme-consistency-checker': ['ui', ['theming', 'variants', 'consistency']],
  '20-narrative-state-debugger': [
    'debugging',
    ['agentic-ui', 'state-desync', 'session-state'],
    'ui',
  ],
  '21-code-complexity-reducer': ['build', ['refactoring', 'complexity', 'nesting'], 'debugging'],
  '22-apple-hig-design': ['design', ['hig', 'apple', 'native-patterns', 'platform'], 'ui'],
  '23-fast-task-completion-mode': ['orchestration', ['execution-mode', 'batching', 'efficiency']],
  '24-secrets-credential-leak-scanner': ['ops', ['secrets', 'security', 'git-history', 'leaks']],
  '25-i18n-localization-completeness-checker': [
    'verification',
    ['i18n', 'l10n', 'translations', 'completeness'],
  ],
  '26-dead-code-unused-export-finder': ['verification', ['dead-code', 'imports', 'audit'], 'build'],
  '27-bundle-size-auditor': ['ops', ['bundle-size', 'dependencies', 'tree-shaking'], 'build'],
  '28-flaky-test-detector': ['testing', ['flaky-tests', 'diagnosis', 'ci']],
  '29-feature-flag-lifecycle-manager': ['ops', ['feature-flags', 'rollout', 'cleanup']],
  '30-changelog-release-notes-generator': ['ops', ['changelog', 'release-notes', 'git-log']],
  '31-api-rate-limit-backoff-auditor': ['ops', ['rate-limits', 'backoff', 'retries', 'api']],
  '32-config-parity-checker': ['ops', ['config', 'environments', 'drift']],
  '33-error-logging-consistency-enforcer': [
    'verification',
    ['logging', 'errors', 'consistency'],
    'ops',
  ],
  '34-commit-message-quality-skill': ['ops', ['git', 'commit-messages', 'conventions']],
  '35-full-app-from-prompt-builder': [
    'build',
    ['scaffolding', 'full-app', 'codegen', 'architecture'],
  ],
  '36-self-healing-build-loop': ['build', ['build-loop', 'autonomous', 'error-parsing'], 'testing'],
  '37-multi-agent-task-orchestrator': ['orchestration', ['multi-agent', 'roles', 'handoffs']],
  '38-autonomous-root-cause-debugger': [
    'debugging',
    ['root-cause', 'instrumentation', 'hypotheses'],
  ],
  '39-live-architecture-decision-recorder': [
    'orchestration',
    ['adr', 'decisions', 'documentation'],
  ],
  '40-spec-to-build-plan-converter': ['orchestration', ['planning', 'spec', 'milestones']],
  '41-multimodal-spec-binder': ['import', ['multimodal', 'images', 'spec-binding', 'context']],
  '42-continuous-quality-gate': ['verification', ['quality-gate', 'checklist', 'lint', 'types']],
  '43-autonomous-adversarial-reviewer': [
    'verification',
    ['adversarial-review', 'self-review', 'diffs'],
  ],
  '44-prototype-to-production-hardener': [
    'build',
    ['hardening', 'validation', 'security', 'production'],
    'ops',
  ],
  // Fires on output-style requests, not a workflow domain — hence the
  // dedicated output-style category rather than folding into orchestration.
  '45-caveman-compressed-mode': [
    'output-style',
    ['terse', 'token-efficiency', 'prose', 'compression'],
  ],
};

// skills/<name>/SKILL.md — frontmatter style, primary trigger = when the task
// touches that domain. Categories follow the domain of the skill itself.
const CORE_CATEGORY = {
  accessibility: ['verification', ['accessibility', 'a11y', 'aria'], 'ui'],
  'agent-coordination': ['orchestration', ['multi-agent', 'coordination', 'delegation']],
  'api-engineering': ['build', ['api', 'backend', 'contracts']],
  architecture: ['orchestration', ['architecture', 'design', 'boundaries'], 'build'],
  'autonomous-task-execution': ['orchestration', ['autonomy', 'end-to-end', 'ownership']],
  'change-impact-analysis': ['debugging', ['impact-analysis', 'dependencies', 'risk']],
  'code-review': ['verification', ['review', 'diffs', 'quality']],
  'core-engineering': ['build', ['standards', 'engineering', 'baseline']],
  database: ['build', ['database', 'sql', 'schemas', 'transactions'], 'ops'],
  debugging: ['debugging', ['root-cause', 'evidence', 'diagnosis']],
  'dependency-management': ['ops', ['dependencies', 'updates', 'supply-chain'], 'build'],
  documentation: ['ops', ['documentation', 'readme', 'docs'], 'orchestration'],
  'frontend-engineering': ['ui', ['frontend', 'react', 'components', 'web']],
  'git-workflow': ['ops', ['git', 'branching', 'commits'], 'build'],
  implementation: ['build', ['implementation', 'edits', 'minimal-change']],
  'incident-recovery': ['debugging', ['recovery', 'regressions', 'rollback'], 'ops'],
  migrations: ['build', ['migrations', 'database', 'data'], 'ops'],
  observability: ['ops', ['logging', 'metrics', 'tracing'], 'debugging'],
  performance: ['debugging', ['performance', 'profiling', 'optimization'], 'testing'],
  planning: ['orchestration', ['planning', 'spec', 'breakdown']],
  'quality-gates': ['verification', ['quality-gate', 'checklist', 'completion']],
  refactoring: ['build', ['refactoring', 'structure', 'behavior-preserving'], 'debugging'],
  'release-engineering': ['ops', ['release', 'deploy', 'build'], 'build'],
  'repo-exploration': ['import', ['exploration', 'codebase', 'onboarding', 'context']],
  research: ['import', ['research', 'evidence', 'external-context']],
  security: ['verification', ['security', 'owasp', 'vulnerabilities'], 'ops'],
  'task-memory': ['orchestration', ['memory', 'context', 'task-state']],
  'terminal-safety': ['ops', ['terminal', 'shell', 'safety'], 'build'],
  testing: ['testing', ['tests', 'coverage', 'reliability']],
  'ui-design': ['ui', ['ui', 'design-system', 'polish', 'states'], 'design'],
};

// ---------- skill extraction ----------

function stripFrontmatter(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function extractExtra(id, file) {
  const md = readFileSync(file, 'utf8');
  const name = h1(md);
  const trigger = condenseTrigger(section(md, 'Trigger'));
  const summary = firstSentence(section(md, 'What it does'));
  const [category, tags, secondary] = EXTRA_CATEGORY[id] ?? ['build', [], 'orchestration'];
  const allTags = secondary && !tags.includes(secondary) ? [...tags, secondary] : tags;
  return {
    id,
    name,
    file: relative(PACK, file).split(sep).join('/'),
    category,
    trigger,
    summary,
    tags: allTags,
    irregular: !trigger || !summary,
  };
}

function extractCore(dirName, file) {
  const raw = readFileSync(file, 'utf8');
  const md = stripFrontmatter(raw);
  const fmName = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const fmDesc = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const name = fmName ? fmName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : h1(md);
  const summary =
    fmDesc ?? firstSentence(md.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '');
  const [category, tags, secondary] = CORE_CATEGORY[dirName] ?? ['build', [], 'orchestration'];
  const allTags = secondary && !tags.includes(secondary) ? [...tags, secondary] : tags;
  // Frontmatter style has no Trigger section; derive trigger keywords from tags + name.
  const trigger = `When the task involves ${dirName.replace(/-/g, ' ')}`;
  return {
    id: dirName,
    name,
    file: relative(PACK, file).split(sep).join('/'),
    category,
    trigger,
    summary,
    tags: allTags,
    irregular: false,
  };
}

// ---------- assemble ----------

const skills = {};
const irregular = [];

for (const f of readdirSync(EXTRA)
  .filter((f) => f.endsWith('.md') && f !== '00-README.md')
  .sort()) {
  const id = f.replace(/\.md$/, '');
  const s = extractExtra(id, join(EXTRA, f));
  skills[s.id] = {
    name: s.name,
    file: s.file,
    category: s.category,
    trigger: s.trigger,
    summary: s.summary,
    tags: s.tags,
  };
  if (s.irregular) irregular.push(s.id);
}

for (const dir of readdirSync(CORE).filter((d) => !d.startsWith('.'))) {
  const file = join(CORE, dir, 'SKILL.md');
  if (!existsSync(file)) continue;
  const s = extractCore(dir, file);
  skills[s.id] = {
    name: s.name,
    file: s.file,
    category: s.category,
    trigger: s.trigger,
    summary: s.summary,
    tags: s.tags,
  };
  if (s.irregular) irregular.push(s.id);
}

const CATEGORIES = [
  'ui',
  'design',
  'verification',
  'testing',
  'build',
  'debugging',
  'ops',
  'orchestration',
  'import',
  'output-style',
];
const LABELS = {
  ui: 'UI',
  design: 'Design',
  verification: 'Verification',
  testing: 'Testing',
  build: 'Build',
  debugging: 'Debugging',
  ops: 'Ops',
  orchestration: 'Orchestration',
  import: 'Import',
  'output-style': 'Output Style',
};

const categories = Object.fromEntries(CATEGORIES.map((c) => [c, { label: LABELS[c], skills: [] }]));
for (const [id, s] of Object.entries(skills)) {
  (categories[s.category] ?? categories.build).skills.push(id);
}
for (const c of CATEGORIES) categories[c].skills.sort();

const manifest = { categories, skills };
writeFileSync(join(PACK, 'skills-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// ---------- README ----------

const total = Object.keys(skills).length;
let readme = `# Aether Skill Pack — Organized Index (${total} skills)\n\n`;
readme += `Machine-readable index: \`skills-manifest.json\` — filter by category or pick ids; consumers concatenate the full markdown into task context.\n\n`;
readme += `Two formats live here: \`agent-extra-skills/NN-*.md\` (Trigger / What it does / Process / Output format / Guardrails) and \`skills/<name>/SKILL.md\` (frontmatter + guidance bullets). Agent role docs (\`agents/\`) and the constitution (\`AETHER.md\`) are not skills and are excluded.\n`;
for (const c of CATEGORIES) {
  const ids = categories[c].skills;
  if (!ids.length) continue;
  readme += `\n## ${LABELS[c]} (${ids.length})\n\n`;
  for (const id of ids) {
    readme += `- **${skills[id].name}** (\`${id}\`) — ${skills[id].summary}\n`;
  }
}
writeFileSync(join(PACK, 'README.md'), readme);

// ---------- report ----------

console.log(`Manifest written: ${total} skills`);
for (const c of CATEGORIES) console.log(`  ${c.padEnd(14)} ${categories[c].skills.length}`);
console.log(`Irregular files: ${irregular.length ? irregular.join(', ') : 'none'}`);
