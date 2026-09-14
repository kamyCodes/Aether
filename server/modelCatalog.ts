/**
 * Model catalog enrichment: normalizes gateway /models output (adds routing
 * aliases, free-tier flags, category hints) used by router.ts and settings.
 */
import type { ModelInfo } from '../shared/types.js';

/**
 * Pure filtering logic for the OmniRoute model catalog. The /v1/models
 * endpoint does not expose pricing, so "free" is inferred with these rules,
 * in order:
 *   1. id ends with ":free"
 *   2. owned_by is a known always-free provider
 *   3. name contains a free-tier marker (🆓 used by theoldllm)
 * Everything else is treated as paid/unknown and excluded by default.
 * Combo-owned auto/* entries are routing aliases, not real models — they are
 * always selectable and never subject to the free rules.
 */

export const FREE_PROVIDERS = new Set([
  'g4f-pollinations',
  'felo-web',
  'duckduckgo-web',
  'theoldllm',
  'veoaifree-web',
]);

/** Model types the IDE has no use for in chat/coding features. */
const EXCLUDED_TYPES = new Set(['embedding', 'rerank', 'audio', 'video', 'image']);

export function isFreeModel(model: Pick<ModelInfo, 'id' | 'owned_by' | 'name'>): boolean {
  if (model.id.endsWith(':free')) return true;
  if (model.owned_by && FREE_PROVIDERS.has(model.owned_by)) return true;
  if (model.name && /\u{1F193}/u.test(model.name)) return true; // 🆓 squared-free marker
  return false;
}

export function isRoutingAlias(model: Pick<ModelInfo, 'id' | 'owned_by'>): boolean {
  return model.owned_by === 'combo' || model.id.startsWith('auto/');
}

export function isChatCapable(model: Pick<ModelInfo, 'type' | 'object'>): boolean {
  if (model.type && EXCLUDED_TYPES.has(model.type)) return false;
  // Some gateways mark embeddings via the object field ("model.v1" is fine,
  // but a bare non-model object like "embedding" is not chat-capable).
  if (model.object && model.object !== 'model' && EXCLUDED_TYPES.has(model.object)) return false;
  return true;
}

/** The full catalog filtered down to what the model picker should offer. */
export function getSelectableModels(
  allModels: Pick<ModelInfo, 'id' | 'owned_by' | 'name' | 'type' | 'object'>[],
): ModelInfo[] {
  return allModels.filter(
    (m) => isChatCapable(m) && (isRoutingAlias(m) || isFreeModel(m)),
  ) as ModelInfo[];
}

/**
 * Enrich a raw gateway catalog entry with the inferred flags the UI and
 * router rely on. Pure: returns a new object.
 */
export function enrichModel(m: ModelInfo): ModelInfo {
  return {
    ...m,
    vision: m.vision ?? /vision|vl|llava|omni|image/i.test(m.id),
    reasoner: m.reasoner ?? /o[1345](-|$)|reason|think|r1/i.test(m.id),
    free: isRoutingAlias(m) ? undefined : isFreeModel(m),
    routingAlias: isRoutingAlias(m),
  };
}
