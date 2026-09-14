/**
 * OmniClient — HTTP client for the OpenAI-compatible model gateway
 * (OmniRoute). Handles model discovery, chat completion streaming, and API
 * key resolution/masking. Security-sensitive: never logs full keys.
 */
import type { ModelInfo, OmniSettings } from '../shared/types.js';
import { enrichModel, getSelectableModels } from './modelCatalog.js';

/** Mask an API key for logs/UI: sk-1f18****3fc5 style. */
export function maskKey(key: string): string {
  if (!key) return '(none)';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
}

/**
 * Resolve the API key: the settings value wins (UI-configured), otherwise
 * the OMNIROUTE_API_KEY environment variable. Never logged in full.
 */
export function resolveApiKey(): string {
  return process.env.OMNIROUTE_API_KEY ?? '';
}

/** Heuristic context-window guess when the gateway omits `context_window`. */
function guessContext(id: string): number {
  if (/o[1345](-|$)/.test(id)) return 128_000;
  if (/4\.1|4o|4\.5|\bclaude\b|\bgemini\b/i.test(id)) return 128_000;
  if (/gpt-5|gpt-4\b|opus|sonnet|haiku|lumo|glm|live|atlas|lite|mini/i.test(id)) return 128_000;
  if (/(pro|max|large)\b/i.test(id)) return 128_000;
  if (/\bsmall\b|m\d\b/i.test(id)) return 16_384;
  return 128_000;
}

export class OmniClient {
  /** Live model catalog from the gateway's /models endpoint (last successful fetch). */
  _modelCatalog: ModelInfo[] = [];
  /** Cached selectable list (aliases + free, chat-capable) — mirrors _modelCatalog. */
  selectableModels: ModelInfo[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  settings: OmniSettings;

  constructor(settings: OmniSettings) {
    this.settings = settings;
    // Periodic catalog refresh (every 10 min) keeps free-model discovery
    // current without manual action.
    this.refreshTimer = setInterval(
      () => {
        void this.listModels().catch(() => {
          /* unreachable; cache retains last known */
        });
      },
      10 * 60 * 1000,
    );
    this.refreshTimer.unref?.();
  }

  /** Effective auth key: settings value first, then OMNIROUTE_API_KEY env. */
  private get apiKey() {
    return this.settings.apiKey || resolveApiKey();
  }

  private get baseUrl() {
    return this.settings.baseUrl;
  }
  private get timeoutMs() {
    return this.settings.timeoutMs;
  }
  private get streaming() {
    return this.settings.streaming;
  }

  url(p: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
  }

  headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async status(): Promise<{ models: ModelInfo[] }> {
    return { models: await this.listModels() };
  }

  async listModels(): Promise<ModelInfo[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url('/models'), {
        headers: this.headers(),
        signal: ctrl.signal,
      });
      if (!res.ok)
        throw new Error(`Model endpoint /models failed: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { data?: ModelInfo[] } | ModelInfo[];
      const src = Array.isArray(data) ? data : (data.data ?? []);
      const models = src.map((m) =>
        enrichModel({
          ...m,
          contextWindow: (m as ModelInfo).contextWindow ?? guessContext(m.id),
        }),
      );
      // Only overwrite the cached catalog when the fetch is nonempty — a
      // transient empty response should never wipe known-good state.
      if (models.length) {
        this._modelCatalog = models;
        this.selectableModels = getSelectableModels(models);
      }
      return models;
    } finally {
      clearTimeout(t);
    }
  }

  async chatStream(
    body: {
      model: string;
      messages: { role: string; content: unknown }[];
      temperature?: number;
      max_tokens?: number;
      tools?: unknown[];
      signal?: AbortSignal;
    },
    handlers: {
      onDelta: (text: string) => void;
      onToolCall?: (tc: { id: string; name: string; arguments: string }) => void;
      onUsage?: (
        u: {
          model: string;
          inputTokens: number;
          outputTokens: number;
          cachedInput?: number;
        } | null,
      ) => void;
    },
  ): Promise<{
    text: string;
    toolCalls: { id: string; name: string; arguments: string }[];
    finish: string | null;
    resolvedModel: string | null;
  }> {
    let text = '';
    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    let finish: string | null = null;
    // The OpenAI-compatible `model` field of the reply — the gateway sets it
    // to the model that actually served the request, which can differ from
    // the requested one on alias resolution or fallback rotation.
    let resolvedModel: string | null = null;

    const doCall = async (signal?: AbortSignal) => {
      const res = await fetch(this.url('/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          temperature: body.temperature ?? 0.2,
          max_tokens: body.max_tokens,
          tools: body.tools,
          stream: this.streaming,
          stream_options: this.streaming ? { include_usage: true } : undefined,
        }),
        signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(
          `Chat request failed: ${res.status} ${res.statusText} ${errText.slice(0, 300)}`,
        );
      }
      const contentType = res.headers.get('content-type') ?? '';
      const replyIsSse = contentType.includes('text/event-stream');
      if (!replyIsSse) {
        const data: any = await res.json();
        resolvedModel = (data?.model as string) ?? resolvedModel;
        const msg = data.choices?.[0]?.message ?? {};
        text = typeof msg.content === 'string' ? msg.content : '';
        if (text) handlers.onDelta(text);
        for (const tc of msg.tool_calls ?? []) {
          toolCalls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
          handlers.onToolCall?.({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
        if (data.usage)
          handlers.onUsage?.({
            model: (data.model as string) ?? body.model,
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            cachedInput: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
          });
        finish = data.choices?.[0]?.finish_reason ?? 'stop';
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const partial = new Map<number, { id: string; name: string; arguments: string }>();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            if (typeof json.model === 'string' && json.model) resolvedModel = json.model;
            const delta = json.choices?.[0]?.delta;
            if (json.usage)
              handlers.onUsage?.({
                model: (json.model as string) ?? body.model,
                inputTokens: json.usage.prompt_tokens,
                outputTokens: json.usage.completion_tokens,
                cachedInput: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
              });
            if (delta?.content) {
              text += delta.content;
              handlers.onDelta(delta.content);
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const cur = partial.get(idx) ?? { id: tc.id ?? '', name: '', arguments: '' };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name += tc.function.name;
                if (tc.function?.arguments) cur.arguments += tc.function.arguments;
                partial.set(idx, cur);
              }
            }
            if (json.choices?.[0]?.finish_reason) {
              finish = json.choices[0].finish_reason;
              for (const tc of partial.values()) toolCalls.push(tc);
              break;
            }
          } catch {
            /* skip malformed SSE frames */
          }
        }
        if (finish) break;
      }
    };

    try {
      await doCall(body.signal);
      // Retry once on a protocol-level failure (dead gateway, 502, timeout).
      // Don't retry validation errors from the gateway itself — the body
      // already reached it; retrying usually just repeats the failure.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('AbortError') ||
        msg.includes('50') ||
        msg.includes('timeout') ||
        msg.includes('Failed to fetch')
      ) {
        try {
          await doCall(body.signal);
        } catch (e2) {
          const m2 = e2 instanceof Error ? e2.message : String(e2);
          throw new Error(`Model request failed (2 attempts): ${msg}; retry: ${m2}`);
        }
      } else {
        throw e;
      }
    }

    return { text, toolCalls, finish, resolvedModel };
  }
}
