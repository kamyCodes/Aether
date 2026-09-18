import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  X,
  FolderOpen,
  Server,
  FolderPlus,
  ClipboardCheck,
  AlertTriangle,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { get, post } from '../lib/api';

/**
 * First-run setup wizard — blocks the IDE until setup completes or the user
 * explicitly defers. OmniRoute is configured automatically (no manual API key
 * entry). Database is embedded SQLite (no configuration needed).
 */

interface StepCheck {
  ok: boolean;
  detail: string;
}
interface SetupState {
  complete: boolean;
  skipped: string[] | undefined;
  recovery: { reason: string; detail: string; backups: string[] } | null;
  dataDir: string;
  dataDirWritable: boolean | null;
  defaults: { dataDir: string; omniBaseUrl: string; defaultProjectsDir: string };
}
interface CompletionResult {
  ok: boolean;
  checks: { item: string; ok: boolean; detail: string }[];
}

const STEPS = [
  { key: 'data', title: 'Welcome & data location', icon: FolderOpen },
  { key: 'omni', title: 'AI models', icon: Server },
  { key: 'workspace', title: 'Projects folder', icon: FolderPlus },
  { key: 'review', title: 'Review & finish', icon: ClipboardCheck },
] as const;

/** One validation result row (used inline + in the review checklist). */
function CheckRow({ ok, detail }: { ok: boolean; detail: string }) {
  return (
    <div className={`setup-check ${ok ? 'ok' : 'fail'}`}>
      {ok ? <Check size={12} /> : <X size={12} />}
      <span>{detail}</span>
    </div>
  );
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<SetupState | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Step state
  const [dataDir, setDataDir] = useState('');
  const [omniUrl, setOmniUrl] = useState('');
  const [wsDir, setWsDir] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);

  // Per-step live results
  const [ddCheck, setDdCheck] = useState<StepCheck | null>(null);
  const [omniCheck, setOmniCheck] = useState<StepCheck | null>(null);
  const [wdCheck, setWdCheck] = useState<StepCheck | null>(null);
  const [final, setFinal] = useState<CompletionResult | null>(null);

  // OmniRoute auto-setup status
  const [omniStatus, setOmniStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    void (async () => {
      try {
        const s = await get<SetupState>('/setup/state');
        setState(s);
        setDataDir(s.dataDir);
        setOmniUrl(s.defaults.omniBaseUrl);
        setWsDir(s.defaults.defaultProjectsDir);
      } catch {
        setState(null);
      }
    })();
  }, []);

  const pickFolder = useCallback(async (current: string): Promise<string | null> => {
    try {
      const r = await post<{ dir: string | null }>('/pick-folder', {
        startDir: current,
        marker: 'setup',
      });
      return r.dir;
    } catch {
      return null;
    }
  }, []);

  if (!state) return null;

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const runDataDirCheck = async () => {
    setBusy(true);
    setDdCheck(null);
    try {
      setDdCheck(await post<StepCheck>('/setup/check/datadir', { dir: dataDir }));
    } catch (e) {
      setDdCheck({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runOmniCheck = async () => {
    setBusy(true);
    setOmniCheck(null);
    setOmniStatus('testing');
    try {
      // Test the auto-configured OmniRoute endpoint
      const result = await post<StepCheck>('/setup/check/omni', { baseUrl: omniUrl, apiKey: '' });
      setOmniCheck(result);
      setOmniStatus(result.ok ? 'ok' : 'fail');
    } catch (e) {
      setOmniCheck({ ok: false, detail: e instanceof Error ? e.message : String(e) });
      setOmniStatus('fail');
    } finally {
      setBusy(false);
    }
  };

  const runWsCheck = async () => {
    setBusy(true);
    setWdCheck(null);
    try {
      setWdCheck(await post<StepCheck>('/setup/check/workspacedir', { dir: wsDir }));
    } catch (e) {
      setWdCheck({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setFinal(null);
    try {
      const r = await post<CompletionResult>('/setup/complete', {
        dataDir,
        omni: { baseUrl: omniUrl, apiKey: '' },
        workspace: { defaultDir: wsDir },
        skipped,
      });
      setFinal(r);
    } catch (e) {
      setFinal({
        ok: false,
        checks: [{ item: 'Setup', ok: false, detail: e instanceof Error ? e.message : String(e) }],
      });
    } finally {
      setBusy(false);
    }
  };

  // ---- Recovery screen (corrupt / newer schema settings file) ----
  if (state.recovery) {
    return createPortal(
      <div className="modal-overlay setup-overlay">
        <div className="modal setup-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="setup-head">
            <ShieldAlert size={16} className="warn" />
            <strong>Settings need attention</strong>
          </div>
          <div className="setup-body">
            <p className="setup-note">
              {state.recovery.reason === 'corrupt'
                ? 'Your settings file could not be read.'
                : 'Your settings file was written by a newer version of Aether.'}{' '}
              The original file is untouched — nothing has been overwritten.
            </p>
            <p className="setup-detail">{state.recovery.detail}</p>
            {state.recovery.backups.length > 0 && (
              <p className="setup-detail">
                {state.recovery.backups.length} automatic backup(s) available.
              </p>
            )}
            <RecoveryActions onDone={onDone} hasBackups={state.recovery.backups.length > 0} />
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Can proceed: step 0 requires ddCheck OK; step 1 requires omniCheck OK or auto-setup;
  // step 2 requires wdCheck OK; step 3 requires final OK.
  const canNext =
    step === 0
      ? !!ddCheck?.ok
      : step === 1
        ? !!omniCheck?.ok || omniStatus === 'ok'
        : step === 2
          ? !!wdCheck?.ok
          : !!final?.ok;

  return createPortal(
    <div className="modal-overlay setup-overlay">
      <div className="modal setup-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="setup-head">
          <strong>Welcome to Aether</strong>
          <span className="setup-stepper">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`setup-dot ${i === step ? 'on' : i < step ? 'done' : ''}`}
              />
            ))}
          </span>
        </div>

        <div className="setup-body">
          {step === 0 && (
            <>
              <h3>
                <FolderOpen size={13} /> Where Aether stores your data
              </h3>
              <p className="setup-note">
                Settings, task history, and memory live here — separate from the app install, so
                updates never touch it.
              </p>
              <div className="setup-field">
                <label>Data directory</label>
                <div className="setup-inputrow">
                  <input
                    value={dataDir}
                    onChange={(e) => {
                      setDataDir(e.target.value);
                      setDdCheck(null);
                    }}
                  />
                  <button
                    onClick={() =>
                      void pickFolder(dataDir).then((d) => {
                        if (d) {
                          setDataDir(d);
                          setDdCheck(null);
                        }
                      })
                    }
                  >
                    Browse…
                  </button>
                </div>
              </div>
              {ddCheck && <CheckRow {...ddCheck} />}
              <div className="choice-row">
                <button disabled={busy || !dataDir} onClick={() => void runDataDirCheck()}>
                  {busy ? 'Testing…' : 'Test this location'}
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h3>
                <Server size={13} /> AI models
              </h3>
              <p className="setup-note">
                OmniRoute is installed and configured automatically — it provides free models
                out of the box. No API key or manual setup required.
              </p>
              <div className="setup-field">
                <label>Gateway endpoint</label>
                <input value={omniUrl} readOnly style={{ opacity: 0.7 }} />
              </div>
              {omniCheck && <CheckRow {...omniCheck} />}
              <div className="choice-row">
                <button
                  disabled={busy}
                  onClick={() => void runOmniCheck()}
                >
                  {busy ? <Loader2 size={12} className="spin" /> : null}
                  {omniStatus === 'testing' ? 'Testing…' : omniStatus === 'ok' ? 'Re-test connection' : 'Test connection'}
                </button>
              </div>
              <p className="setup-note" style={{ fontSize: 11, marginTop: 8 }}>
                You can add your own API keys for paid models later in Settings.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <h3>
                <FolderPlus size={13} /> Default projects folder
              </h3>
              <p className="setup-note">New workspaces are suggested from here.</p>
              <div className="setup-field">
                <label>Folder</label>
                <div className="setup-inputrow">
                  <input
                    value={wsDir}
                    onChange={(e) => {
                      setWsDir(e.target.value);
                      setWdCheck(null);
                    }}
                  />
                  <button
                    onClick={() =>
                      void pickFolder(wsDir).then((d) => {
                        if (d) {
                          setWsDir(d);
                          setWdCheck(null);
                        }
                      })
                    }
                  >
                    Browse…
                  </button>
                </div>
              </div>
              {wdCheck && <CheckRow {...wdCheck} />}
              <div className="choice-row">
                <button disabled={busy || !wsDir} onClick={() => void runWsCheck()}>
                  {busy ? 'Checking…' : 'Create & verify'}
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h3>
                <ClipboardCheck size={13} /> Review
              </h3>
              <div className="setup-summary">
                <div>
                  <span>Data directory</span>
                  <code>{dataDir}</code>
                </div>
                <div>
                  <span>Model gateway</span>
                  <code>{omniUrl} (auto-configured)</code>
                </div>
                <div>
                  <span>Database</span>
                  <code>SQLite (embedded, no setup needed)</code>
                </div>
                <div>
                  <span>Projects folder</span>
                  <code>{wsDir}</code>
                </div>
              </div>
              <div className="choice-row">
                <button className="primary" disabled={busy} onClick={() => void finish()}>
                  {busy ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Finish setup
                </button>
              </div>
              {final && (
                <div className="setup-final">
                  {final.checks.map((c) => (
                    <CheckRow key={c.item} ok={c.ok} detail={`${c.item}: ${c.detail}`} />
                  ))}
                  {final.ok && (
                    <div className="choice-row">
                      <button className="primary" onClick={onDone}>
                        Start using Aether
                      </button>
                    </div>
                  )}
                  {!final.ok && (
                    <p className="setup-note warn">
                      Some checks failed. You can still enter the IDE — failed features show their
                      "not configured" state — or go back and fix them.
                    </p>
                  )}
                  {!final.ok && (
                    <div className="choice-row">
                      <button onClick={onDone}>Enter anyway (partially configured)</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="setup-foot">
          <button disabled={step === 0} onClick={back}>
            Back
          </button>
          <div style={{ flex: 1 }} />
          <button className="primary" disabled={!canNext || busy} onClick={next}>
            {step === STEPS.length - 1 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RecoveryActions({ onDone, hasBackups }: { onDone: () => void; hasBackups: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const run = async (action: 'restore-backup' | 'reset' | 'accept-defaults', body?: unknown) => {
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; detail: string }>(`/setup/recover/${action}`, body);
      setResult(`${r.ok ? '✓' : '✗'} ${r.detail}`);
      if (r.ok) setTimeout(onDone, 900);
    } catch (e) {
      setResult(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="choice-row">
        {hasBackups && (
          <button disabled={busy} onClick={() => void run('restore-backup')}>
            Restore latest backup
          </button>
        )}
        <button disabled={busy} onClick={() => void run('reset', { keepBackups: true })}>
          Start fresh (keep old file as backup)
        </button>
        <button disabled={busy} onClick={() => void run('accept-defaults')}>
          Continue with defaults
        </button>
      </div>
      {result && <p className="setup-detail">{result}</p>}
      <p className="setup-note">
        <AlertTriangle size={11} /> Your user data is never deleted — reset only renames the
        unreadable file aside.
      </p>
    </>
  );
}
