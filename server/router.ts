import type { ModelInfo, RoutingDecision, TaskCategory } from '../shared/types.js';

/**
 * Task-based automatic model routing. Each category has a preference list of
 * models (real free models first when discovered, routing aliases as the
 * guaranteed fallback). The first candidate present in the current
 * selectable set wins; auto/best-free is the terminal fallback.
 */

export const CATEGORY_PREFERENCES: Record<TaskCategory, string[]> = {
  coding: ['auto/coding:free', 'auto/best-free'],
  debugging: ['auto/coding:free', 'auto/best-free'],
  testing: ['auto/coding:free', 'auto/best-free'],
  planning: ['auto/best-free'],
  chat: ['auto/chat', 'auto/best-free'],
  vision: ['auto/vision', 'auto/best-free'],
};

export const DEFAULT_FALLBACK = 'auto/best-free';

/**
 * Classify a task into a category from its context. Order matters: more
 * specific signals (errors → debugging, test files → testing) are checked
 * before generic ones.
 */
export function classifyTask(input: {
  prompt: string;
  mode?: 'agent' | 'ask' | 'plan';
  files?: string[];
  hasErrorText?: boolean;
  hasImage?: boolean;
}): { category: TaskCategory; reason: string } {
  const prompt = input.prompt.toLowerCase();
  const files = (input.files ?? []).map((f) => f.toLowerCase());

  if (
    input.hasImage ||
    /\.(png|jpe?g|gif|webp|bmp)$/.test(prompt) ||
    files.some((f) => /\.(png|jpe?g|gif|webp|bmp)$/.test(f))
  ) {
    return { category: 'vision', reason: 'image attachment or image path in the task' };
  }
  if (
    input.hasErrorText ||
    /error|exception|stack ?trace|traceback|fails?|crash|bug|broken|cannot|unable to/i.test(prompt)
  ) {
    return { category: 'debugging', reason: 'error/failure language in the task' };
  }
  if (
    files.some((f) => /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.test\.|\.spec\./.test(f)) ||
    /\btest(s|ing)?\b|\bspec\b|\bcoverage\b/.test(prompt)
  ) {
    return { category: 'testing', reason: 'test files or test vocabulary in the task' };
  }
  if (
    input.mode === 'plan' ||
    /^\[plan\]/i.test(prompt) ||
    /\bplan\b|\bdesign\b|\barchitect|\brefactor\b|\bapproach\b|\bsteps\b/.test(prompt)
  ) {
    return { category: 'planning', reason: 'planning vocabulary or plan mode' };
  }
  if (input.mode === 'ask') {
    return { category: 'chat', reason: 'ask mode is conversational' };
  }
  return { category: 'coding', reason: 'default for agent tasks without a more specific signal' };
}

/**
 * Cooldown exclusion: models in their post-failure cooldown window are
 * skipped in routing (no wasted round-trip — fall straight through to the
 * next preference). Backed by ~/.aether/health.json via HealthMonitor, so
 * the exclusion list is data-driven and expires on its own — never a
 * hardcoded exclusion in code. Provider status changes over time; a cooled-
 * down model is re-probed on the health schedule and automatically returns
 * to rotation when a probe (or real traffic) succeeds.
 */
export type CooldownCheck = (model: string) => boolean;

/**
 * Pick the model for a task: the first entry in the category's preference
 * list that exists in the selectable set AND is not in cooldown, else the
 * terminal fallback.
 */
export function pickModelForTask(
  input: Parameters<typeof classifyTask>[0],
  selectable: Pick<ModelInfo, 'id'>[],
  isInCooldown: CooldownCheck = () => false,
): RoutingDecision {
  const { category, reason } = classifyTask(input);
  const available = new Set(selectable.map((m) => m.id));
  const prefs = CATEGORY_PREFERENCES[category];

  const candidates: string[] = [];
  for (const p of prefs) {
    if (!available.has(p)) continue;
    if (isInCooldown(p)) {
      candidates.push(p);
      continue; // cooled down — skip without attempting it
    }
    return {
      model: p,
      category,
      reason: `category "${category}" (${reason}) → "${p}" from preference list`,
      candidates,
    };
  }
  // Terminal fallback: auto/best-free is a built-in meta-alias the gateway
  // always resolves, so it is the guaranteed fallback per spec.
  return {
    model: DEFAULT_FALLBACK,
    category,
    reason: candidates.length
      ? `category "${category}" (${reason}) → "${candidates.join('", "')}" in cooldown, fell back to "${DEFAULT_FALLBACK}"`
      : `category "${category}" (${reason}) → no preferred model available, fell back to "${DEFAULT_FALLBACK}"`,
    candidates,
  };
}
