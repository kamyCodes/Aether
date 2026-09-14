/**
 * Mock-gateway guard: detects when the configured OmniRoute baseUrl is being
 * served by a mock/dev process instead of the real gateway.
 *
 * Why this exists: a stray `mock-omni.mjs` process once lost its PORT env on
 * Windows and squatted on the real gateway's port (20128). Every Aether task
 * silently routed to `mock-coder` for hours. This guard makes that failure
 * loud at startup instead of silent.
 *
 * Detection signals, in order of confidence:
 *  - model catalog is tiny (a real gateway exposes dozens-to-thousands of
 *    models; the mock exposes exactly one, `mock-coder`)
 *  - a model id/owned_by/name carries an explicit mock marker
 *    (mock- prefix/suffix, "mock gateway" naming, a :mock tag)
 *
 * This is a heuristic, so it can run in two modes via OMNIROUTE_MOCK_GUARD:
 *   "fail"  — throw at startup (default when STRICT_STARTUP=1)
 *   "warn"  — log a prominent error and continue (default)
 *   "off"   — disabled entirely
 */

export interface MockGuardSignal {
  reason: string;
  /** The model ids that triggered the signal, for the log line. */
  evidence: string[];
}

export interface MockGuardVerdict {
  isMock: boolean;
  signals: MockGuardSignal[];
  /** Human-readable summary for logs and the UI System Log. */
  summary: string;
}

/** A catalog this small is almost certainly a dev mock, never the real router. */
export const MOCK_CATALOG_SIZE_THRESHOLD = 3;

const MOCK_MARKER = /(^|[:\/\s])mock([-_:\s]|$)|mock[-_ ]?(coder|gateway|omni|route)\b|:mock$/i;

/**
 * Pure detection function — unit-testable against sample catalogs.
 * Returns every signal that fires; `isMock` is true if ANY signal fires.
 */
export function detectMockGateway(
  models: { id: string; owned_by?: string; name?: string }[],
): MockGuardVerdict {
  const signals: MockGuardSignal[] = [];
  const ids = models.map((m) => m.id);

  if (models.length === 0) {
    // An empty catalog is already handled by the reachability check; not a
    // mock signal (the gateway may just be starting up).
    return { isMock: false, signals, summary: '' };
  }

  if (models.length < MOCK_CATALOG_SIZE_THRESHOLD) {
    signals.push({
      reason: `catalog has only ${models.length} model(s) — the real OmniRoute gateway exposes hundreds`,
      evidence: ids.slice(0, 5),
    });
  }

  const marked = models.filter(
    (m) =>
      MOCK_MARKER.test(m.id) ||
      MOCK_MARKER.test(m.owned_by ?? '') ||
      MOCK_MARKER.test(m.name ?? ''),
  );
  if (marked.length) {
    signals.push({
      reason: `${marked.length} model(s) carry mock markers in id/owned_by/name`,
      evidence: marked.map((m) => m.id).slice(0, 5),
    });
  }

  const summary = signals.length
    ? `OmniRoute baseUrl looks like a MOCK gateway: ${signals.map((s) => s.reason).join('; ')} ` +
      `(models: ${[...new Set(signals.flatMap((s) => s.evidence))].join(', ')})`
    : '';
  return { isMock: signals.length > 0, signals, summary };
}

export type MockGuardMode = 'fail' | 'warn' | 'off';

export function resolveMockGuardMode(): MockGuardMode {
  const raw = (process.env.OMNIROUTE_MOCK_GUARD || '').trim().toLowerCase();
  if (raw === 'fail' || raw === 'warn' || raw === 'off') return raw;
  // Strict startup opt-in via the generic flag; otherwise default to warn so
  // a misconfigured dev environment never bricks the app silently OR loudly.
  if ((process.env.STRICT_STARTUP || '').trim() === '1') return 'fail';
  return 'warn';
}

/**
 * Startup guard entry point. Throws in `fail` mode, logs prominently
 * otherwise. Returns the verdict so the caller can surface it in the UI.
 */
export function enforceMockGuard(
  verdict: MockGuardVerdict,
  baseUrl: string,
  mode: MockGuardMode = resolveMockGuardMode(),
): MockGuardVerdict {
  if (mode === 'off' || !verdict.isMock) return verdict;
  const line = `[omni] MOCK-GATEWAY GUARD: ${verdict.summary} — baseUrl: ${baseUrl}`;
  if (mode === 'fail') throw new Error(line);
  console.error(`${line}`);
  console.error(
    '[omni] Every task will be served by this mock until the real gateway is reachable. Set OMNIROUTE_MOCK_GUARD=fail to make this fatal.',
  );
  return verdict;
}
