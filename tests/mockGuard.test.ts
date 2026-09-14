import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectMockGateway,
  enforceMockGuard,
  MOCK_CATALOG_SIZE_THRESHOLD,
} from '../server/mockGuard.js';

test('detectMockGateway: real-size clean catalog is not a mock', () => {
  const models = Array.from({ length: 50 }, (_, i) => ({
    id: `openrouter/provider/model-${i}`,
    owned_by: 'openrouter',
    name: `Model ${i}`,
  }));
  const v = detectMockGateway(models);
  assert.equal(v.isMock, false);
  assert.equal(v.signals.length, 0);
});

test('detectMockGateway: tiny catalog fires the size signal', () => {
  const v = detectMockGateway([{ id: 'mock-coder', owned_by: 'mock', name: 'Mock Coder' }]);
  assert.equal(v.isMock, true);
  assert.ok(v.signals.some((s) => s.reason.includes('only 1 model')));
  assert.ok(v.summary.includes('mock-coder'));
});

test('detectMockGateway: mock markers in id/owned_by/name are detected even in a big catalog', () => {
  const models = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `real/model-${i}`, owned_by: 'openrouter' })),
    { id: 'weird-model', owned_by: 'some-provider', name: 'Test Mock Gateway' },
  ];
  const v = detectMockGateway(models);
  assert.equal(v.isMock, true);
  assert.ok(v.signals.some((s) => s.reason.includes('mock markers')));
});

test('detectMockGateway: :mock suffix and mock- prefix markers', () => {
  assert.equal(detectMockGateway([{ id: 'test:mock' }, { id: 'b' }, { id: 'c' }]).isMock, true);
  assert.equal(detectMockGateway([{ id: 'mock-gpt-4' }, { id: 'b' }, { id: 'c' }]).isMock, true);
  // A real, full-size catalog whose models merely look ordinary is fine —
  // note >=3 models so the size signal doesn't fire on this case.
  const real = [
    { id: 'openrouter/anthropic/claude-3', name: 'Claude 3', owned_by: 'openrouter' },
    { id: 'openrouter/openai/gpt-4o', name: 'GPT-4o', owned_by: 'openrouter' },
    { id: 'auto/best-free', name: 'Best free', owned_by: 'combo' },
  ];
  assert.equal(detectMockGateway(real).isMock, false);
});

test('detectMockGateway: empty catalog is not a mock signal (gateway may be starting)', () => {
  const v = detectMockGateway([]);
  assert.equal(v.isMock, false);
  assert.equal(v.summary, '');
});

test('detectMockGateway: threshold is a real-gateway-safe number', () => {
  // The real gateway exposes 1000+ models; the threshold must sit far below.
  assert.ok(MOCK_CATALOG_SIZE_THRESHOLD <= 5);
});

test('enforceMockGuard: warn mode returns verdict without throwing', () => {
  const v = detectMockGateway([{ id: 'mock-coder' }]);
  const out = enforceMockGuard(v, 'http://guard-test.invalid/v1', 'warn');
  assert.equal(out.isMock, true);
});

test('enforceMockGuard: fail mode throws with the summary and baseUrl', () => {
  const v = detectMockGateway([{ id: 'mock-coder' }]);
  assert.throws(() => enforceMockGuard(v, 'http://guard-test.invalid/v1', 'fail'), /MOCK-GATEWAY GUARD.*mock-coder.*guard-test\.invalid/s);
});

test('enforceMockGuard: off mode and clean verdicts are no-ops', () => {
  const mock = detectMockGateway([{ id: 'mock-coder' }]);
  assert.equal(enforceMockGuard(mock, 'http://x', 'off').isMock, true);
  const clean = detectMockGateway([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  assert.equal(enforceMockGuard(clean, 'http://x', 'fail'), clean);
});
