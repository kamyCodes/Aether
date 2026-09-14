import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFreeModel,
  isRoutingAlias,
  isChatCapable,
  getSelectableModels,
  enrichModel,
} from '../server/modelCatalog.js';
import {
  classifyTask,
  pickModelForTask,
  CATEGORY_PREFERENCES,
  DEFAULT_FALLBACK,
} from '../server/router.js';
import { maskKey } from '../server/omni.js';

// ---- Fixtures: entries shaped like the real OmniRoute /v1/models response ----

const FIXTURES = [
  { id: 'auto/best-free', object: 'model', owned_by: 'combo' }, // meta-alias
  { id: 'auto/coding:free', object: 'model', owned_by: 'combo' }, // coding alias (free)
  { id: 'auto/chat', object: 'model', owned_by: 'combo' }, // chat alias
  { id: 'auto/vision', object: 'model', owned_by: 'combo' }, // vision alias
  {
    id: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
    object: 'model',
    owned_by: 'openrouter',
  }, // :free suffix
  { id: 'felo/felo-chat', object: 'model', owned_by: 'felo-web' }, // free provider
  { id: 'ddgw/gpt-5.4-mini', object: 'model', owned_by: 'duckduckgo-web' }, // free provider
  { id: 'tllm/GPT_5_4', object: 'model', owned_by: 'theoldllm', name: 'GPT 5.4 \u{1F193}' }, // 🆓 marker
  { id: 'veoaifree/veo-3', object: 'model', owned_by: 'veoaifree-web' }, // free provider
  { id: 'g4f/llama-3', object: 'model', owned_by: 'g4f-pollinations' }, // free provider
  { id: 'aug/sonnet4.6', object: 'model', owned_by: 'augment' }, // paid/unknown
  { id: 'openrouter/openai/gpt-5-mini', object: 'model', owned_by: 'openrouter' }, // paid/unknown
  { id: 'text-embedding-3', object: 'model', type: 'embedding', owned_by: 'openai' }, // excluded modality
  { id: 'whisper-large', object: 'model', type: 'audio', owned_by: 'openai' }, // excluded modality
  { id: 'rerank-v2', object: 'model', type: 'rerank', owned_by: 'cohere' }, // excluded modality
];

// ---------- isFreeModel ----------

test('isFreeModel: id ending in :free is free', () => {
  assert.equal(
    isFreeModel({
      id: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
      owned_by: 'openrouter',
    }),
    true,
  );
  assert.equal(isFreeModel({ id: 'auto/coding:free', owned_by: 'openrouter' }), true);
});

test('isFreeModel: known always-free providers are free', () => {
  for (const owned_by of [
    'g4f-pollinations',
    'felo-web',
    'duckduckgo-web',
    'theoldllm',
    'veoaifree-web',
  ]) {
    assert.equal(isFreeModel({ id: `x/${owned_by}-model`, owned_by }), true, owned_by);
  }
});

test('isFreeModel: 🆓 marker in name is free', () => {
  assert.equal(isFreeModel({ id: 'tllm/GPT_5_4', owned_by: 'unknown', name: 'GPT 5.4 🆓' }), true);
});

test('isFreeModel: paid/unknown models are not free', () => {
  assert.equal(isFreeModel({ id: 'aug/sonnet4.6', owned_by: 'augment' }), false);
  assert.equal(isFreeModel({ id: 'openrouter/openai/gpt-5-mini', owned_by: 'openrouter' }), false);
});

// ---------- isRoutingAlias ----------

test('isRoutingAlias: combo-owned auto/* entries are aliases', () => {
  assert.equal(isRoutingAlias({ id: 'auto/best-free', owned_by: 'combo' }), true);
  assert.equal(isRoutingAlias({ id: 'auto/coding:fast', owned_by: 'combo' }), true);
});

test('isRoutingAlias: real models are not aliases', () => {
  assert.equal(isRoutingAlias({ id: 'aug/sonnet4.6', owned_by: 'augment' }), false);
});

// ---------- isChatCapable ----------

test('isChatCapable: embeddings/rerank/audio/video/image excluded', () => {
  for (const type of ['embedding', 'rerank', 'audio', 'video', 'image']) {
    assert.equal(isChatCapable({ type, object: 'model' }), false, type);
  }
  assert.equal(isChatCapable({ object: 'model' }), true);
});

// ---------- getSelectableModels ----------

test('getSelectableModels: aliases always included, free models included, paid & non-chat excluded', () => {
  const sel = getSelectableModels(FIXTURES);
  const ids = sel.map((m) => m.id);
  assert.ok(ids.includes('auto/best-free'), 'meta-alias must be selectable');
  assert.ok(ids.includes('auto/coding:free'), 'coding alias must be selectable');
  assert.ok(ids.includes('felo/felo-chat'), 'free provider model must be selectable');
  assert.ok(ids.includes('tllm/GPT_5_4'), '🆓 model must be selectable');
  assert.ok(!ids.includes('aug/sonnet4.6'), 'paid model must be excluded');
  assert.ok(!ids.includes('openrouter/openai/gpt-5-mini'), 'unknown-cost model must be excluded');
  assert.ok(!ids.includes('text-embedding-3'), 'embedding must be excluded');
  assert.ok(!ids.includes('whisper-large'), 'audio must be excluded');
});

// ---------- enrichModel ----------

test('enrichModel: flags free and routingAlias correctly', () => {
  const alias = enrichModel(FIXTURES[0] as any);
  assert.equal(alias.routingAlias, true);
  assert.equal(alias.free, undefined); // aliases bypass the free rules

  const free = enrichModel(FIXTURES[4] as any);
  assert.equal(free.free, true);
  assert.equal(free.routingAlias, false);

  const paid = enrichModel(FIXTURES[10] as any);
  assert.equal(paid.free, false);
});

// ---------- classifyTask ----------

test('classifyTask: errors/debugging language wins', () => {
  assert.equal(
    classifyTask({ prompt: 'fix the TypeError crash on startup' }).category,
    'debugging',
  );
});

test('classifyTask: test files/vocabulary → testing', () => {
  assert.equal(
    classifyTask({ prompt: 'add coverage for parser', files: ['src/__tests__/util.test.ts'] })
      .category,
    'testing',
  );
});

test('classifyTask: image attachment → vision', () => {
  assert.equal(
    classifyTask({ prompt: 'what is in this screenshot', hasImage: true }).category,
    'vision',
  );
});

test('classifyTask: plan mode / planning vocabulary → planning', () => {
  assert.equal(
    classifyTask({ prompt: '[PLAN] restructure the modules', mode: 'plan' }).category,
    'planning',
  );
});

test('classifyTask: ask mode → chat', () => {
  assert.equal(classifyTask({ prompt: 'how does the indexer work', mode: 'ask' }).category, 'chat');
});

test('classifyTask: default → coding', () => {
  assert.equal(classifyTask({ prompt: 'implement a retry helper' }).category, 'coding');
});

// ---------- pickModelForTask ----------

test('pickModelForTask: picks first available preference per category', () => {
  const selectable = getSelectableModels(FIXTURES);
  const d = pickModelForTask({ prompt: 'refactor the parser module' }, selectable);
  assert.equal(d.category, 'planning');
  assert.equal(d.model, 'auto/best-free'); // planning prefs: [auto/best-free]
  assert.ok(d.reason.includes('planning'));
});

test('pickModelForTask: coding prefers auto/coding:free when offered', () => {
  const selectable = [{ id: 'auto/coding:free' }, { id: 'auto/best-free' }];
  const d = pickModelForTask({ prompt: 'implement a feature' }, selectable);
  assert.equal(d.model, 'auto/coding:free');
});

test('pickModelForTask: falls back to auto/best-free when preferences missing', () => {
  const d = pickModelForTask({ prompt: 'implement a feature' }, [{ id: 'auto/best-free' }]);
  assert.equal(d.model, 'auto/best-free');
});

test('pickModelForTask: guaranteed fallback even with empty selectable set', () => {
  const d = pickModelForTask({ prompt: 'fix a bug' }, []);
  assert.equal(d.model, DEFAULT_FALLBACK);
  assert.ok(d.reason.includes('fell back'));
});

test('category preference lists all end with the guaranteed fallback', () => {
  for (const [, prefs] of Object.entries(CATEGORY_PREFERENCES)) {
    assert.ok(
      prefs.includes('auto/best-free'),
      `preferences for ${String(prefs)} must include the fallback`,
    );
  }
});

// ---------- key masking ----------

test('maskKey never exposes the full key', () => {
  const masked = maskKey('sk-1f18abcdef3fc5');
  assert.ok(!masked.includes('abcdef'));
  assert.ok(masked.startsWith('sk-1f'));
  assert.ok(masked.endsWith('3fc5'));
  assert.equal(maskKey(''), '(none)');
});
