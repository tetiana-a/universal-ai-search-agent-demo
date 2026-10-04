// Chat-completion providers for structured extraction, tried in order until one
// answers. Every provider here has a free tier; Pro can point OpenRouter at a
// stronger paid model with PRO_OPENROUTER_MODEL.

export type AiProviderId = "openrouter" | "gemini" | "groq";
export type Edition = "free" | "pro";

type AiProvider = { id: AiProviderId; label: string; endpoint: string; key: string; model: string; models?: string[]; headers?: Record<string, string> };

// Free OpenRouter model IDs come and go. When OPENROUTER_MODEL is not set, the current
// free models are read from OpenRouter's public model list and the best few are tried in
// turn. These IDs are only the fallback when that list cannot be fetched.
export const FALLBACK_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
];
const PREFERRED_FREE = [/nemotron.*super/i, /llama-3\.3-70b/i, /deepseek-(chat|v3)/i, /gemini.*flash/i, /qwen.*(72b|235b|max)/i, /llama-4/i, /mistral-(small|medium)/i, /gpt-oss/i];
let freeModelCache: { at: number; models: string[] } | null = null;

// Only text-in/text-out chat models that support JSON output are usable; music, image,
// audio and embedding models (e.g. Lyria) are never picked even when listed as free.
const NOT_CHAT = /lyria|image|imagen|audio|music|tts|whisper|speech|veo|video|embed|rerank|guard|moderation|vision-only|omni/i;
const REASONING = /reason|thinking|r1\b|qwq|dots-|apodex|note-preview/i;

export function rankFreeModels(list: any[]): string[] {
  const free = (Array.isArray(list) ? list : []).filter((m) => {
    const id = String(m?.id || "");
    const prompt = Number(m?.pricing?.prompt ?? NaN);
    const completion = Number(m?.pricing?.completion ?? NaN);
    const isFree = id.endsWith(":free") && (Number.isNaN(prompt) || prompt === 0) && (Number.isNaN(completion) || completion === 0);
    const out = m?.architecture?.output_modalities;
    const input = m?.architecture?.input_modalities;
    const textOnlyOut = !Array.isArray(out) || (out.length > 0 && out.every((x: string) => x === "text"));
    const textIn = !Array.isArray(input) || input.includes("text");
    const params = Array.isArray(m?.supported_parameters) ? m.supported_parameters : null;
    const json = !params || params.includes("response_format") || params.includes("structured_outputs");
    return id && isFree && textOnlyOut && textIn && json && !NOT_CHAT.test(id) && Number(m?.context_length || 0) >= 16000;
  });
  const score = (m: any) => {
    const id = String(m.id);
    const pref = PREFERRED_FREE.findIndex((re) => re.test(id));
    // Reasoning models spend the small token budget on thinking and often return no JSON.
    return [pref === -1 ? 99 : pref, REASONING.test(id) ? 1 : 0, -Number(m?.context_length || 0)];
  };
  return free
    .map((m) => ({ id: String(m.id), s: score(m) }))
    .sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2] - b.s[2])
    .map((m) => m.id);
}

// Per-instance memory: the model that last answered with valid JSON is tried first, and a
// model that failed (bad request, not JSON) is skipped for a while.
const modelHealth = new Map<string, { goodAt?: number; badUntil?: number }>();
const BAD_FOR_MS = 15 * 60 * 1000;
export function markModel(model: string, ok: boolean) {
  const h = modelHealth.get(model) || {};
  if (ok) modelHealth.set(model, { goodAt: Date.now() });
  else modelHealth.set(model, { ...h, badUntil: Date.now() + BAD_FOR_MS });
}
export function orderByHealth(models: string[]) {
  const now = Date.now();
  const usable = models.filter((m) => !((modelHealth.get(m)?.badUntil || 0) > now));
  const list = usable.length ? usable : models;
  return [...list].sort((a, b) => (modelHealth.get(b)?.goodAt || 0) - (modelHealth.get(a)?.goodAt || 0));
}

// A provider that answered 429 (rate or daily quota) is skipped by every later call in this
// instance: a per-day quota until the next UTC midnight, a per-minute limit for a minute.
// Without this one search burns the whole free daily quota on retries.
const providerBlocked = new Map<string, { until: number; daily: boolean }>();
export function isDailyQuotaMessage(text: string) {
  return /per[- ]?day|daily/i.test(String(text || ""));
}
export function blockProvider(id: string, daily: boolean, now = Date.now()) {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  providerBlocked.set(id, { until: daily ? midnight.getTime() : now + 60_000, daily });
}
export function providerBlock(id: string, now = Date.now()) {
  const b = providerBlocked.get(id);
  return b && b.until > now ? b : null;
}

// Seconds to wait before retrying a per-minute 429: the Retry-After header, Gemini's
// RetryInfo ("retryDelay": "7s"), or a few seconds by default.
export function retryDelayMs(headerValue: string | null, body: unknown) {
  const header = Number(headerValue);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 15_000);
  const match = /retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(JSON.stringify(body || ""));
  return match ? Math.min(Number(match[1]) * 1000, 15_000) : 6_000;
}

// Gemini's free tier allows only a few requests a minute, so parallel batches from one
// search go out at most two at a time.
const inFlight = new Map<string, number>();
async function acquireSlot(id: string, limit: number, deadlineAt: number) {
  while ((inFlight.get(id) || 0) >= limit && Date.now() < deadlineAt - 5000) await new Promise((r) => setTimeout(r, 250));
  inFlight.set(id, (inFlight.get(id) || 0) + 1);
  return () => inFlight.set(id, Math.max(0, (inFlight.get(id) || 1) - 1));
}

export function resetFreeModelCache() { freeModelCache = null; modelHealth.clear(); providerBlocked.clear(); inFlight.clear(); }

async function freeOpenRouterModels(): Promise<string[]> {
  if (freeModelCache && Date.now() - freeModelCache.at < 60 * 60 * 1000) return freeModelCache.models;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(3500), cache: "no-store" });
    const payload: any = await response.json().catch(() => null);
    const ranked = rankFreeModels(payload?.data).slice(0, 6);
    if (ranked.length) {
      freeModelCache = { at: Date.now(), models: ranked };
      return ranked;
    }
  } catch (error) {
    console.warn("[ai] could not read OpenRouter model list:", error instanceof Error ? error.message : error);
  }
  return FALLBACK_FREE_MODELS;
}

export function configuredAiProviders(edition: Edition = "free"): AiProvider[] {
  const out: AiProvider[] = [];
  const zeroCost = process.env.ZERO_COST_MODE === "on";
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();

  if (openRouterKey) {
    const requested = String(
      (edition === "pro" && process.env.PRO_OPENROUTER_MODEL) ||
      process.env.OPENROUTER_MODEL ||
      "",
    ).trim();
    const freeOnlyModel = requested === "openrouter/free" || requested.endsWith(":free")
      ? requested
      : "openrouter/free";

    out.push({
      id: "openrouter",
      label: zeroCost ? "OpenRouter Free" : "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      key: openRouterKey,
      model: zeroCost ? freeOnlyModel : requested || "auto-free",
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://universal-ai-search-agent-demo.vercel.app",
        "X-Title": "Aurelius Universal AI Research Engine",
      },
    });
  }

  // Gemini (Google AI Studio key) and Groq both have free tiers and are the fallback once
  // the OpenRouter free quota is used up. Strict zero-cost mode keeps them on their free
  // models and ignores the Pro model overrides.
  const geminiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "").trim();
  if (geminiKey) {
    out.push({
      id: "gemini",
      label: "Google Gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: geminiKey,
      model: (!zeroCost && edition === "pro" && process.env.PRO_GEMINI_MODEL) || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });
  }

  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (groqKey) {
    out.push({
      id: "groq",
      label: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKey,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    });
  }

  return out;
}

function extractText(response: any) {
  const message = response?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) return message.content.map((part: any) => String(part?.text || "")).join("").trim();
  return "";
}

export function parseJsonLoose(text: string) {
  const trimmed = text.trim().replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("invalid structured output");
}

export type AiAttempt = { provider: AiProviderId; model: string; ok: boolean; message?: string; quota?: boolean };
export type AiExtraction = { parsed: any; usage: any; provider?: AiProviderId; model?: string; attempts: AiAttempt[]; error: string; quotaExhausted?: boolean };

// Tries each configured provider until one returns valid JSON or the time budget runs out.
export async function runStructuredExtraction(options: {
  system: string;
  user: string;
  schema: unknown;
  edition?: Edition;
  deadlineAt: number;
  maxTokens: number;
  perCallTimeoutMs: number;
}): Promise<AiExtraction> {
  const providers = configuredAiProviders(options.edition || "free");
  const attempts: AiAttempt[] = [];
  if (!providers.length) {
    return { parsed: null, usage: null, attempts, error: "No eligible AI provider is configured; results were extracted by rules and need manual review." };
  }
  // One call to one model. A model that rejects response_format is retried once without it.
  async function call(provider: AiProvider, model: string, timeoutMs: number, withFormat: boolean) {
    const user = options.user + "\n\nJSON SCHEMA (follow exactly, return only the JSON object):\n" + JSON.stringify(options.schema);
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + provider.key, "Content-Type": "application/json", ...(provider.headers || {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: options.system }, { role: "user", content: user }],
        temperature: 0.1,
        max_tokens: options.maxTokens,
        ...(withFormat ? { response_format: { type: "json_object" } } : {}),
        // OpenRouter: route only to models that honour response_format (the free router
        // otherwise lands on models that answer in prose).
        ...(withFormat && provider.id === "openrouter" ? { provider: { require_parameters: true } } : {}),
        // Gemini 2.5 thinks by default and the thinking counts against max_tokens, which
        // leaves no room for the JSON. Flash models can turn it off.
        ...(provider.id === "gemini" ? { reasoning_effort: /flash/i.test(model) ? "none" : "low" } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: any = await response.json().catch(() => null);
    // Gemini wraps errors in an array.
    const raw: any = Array.isArray(body) ? body[0] || null : body;
    return { response, raw };
  }

  for (const provider of providers) {
    // OpenRouter: the configured model first, then current free models as a fallback.
    const models = provider.id !== "openrouter"
      ? [provider.model]
      : orderByHealth([...new Set([...(provider.model === "auto-free" ? [] : [provider.model]), ...(await freeOpenRouterModels())])]);
    for (const model of models.slice(0, 4)) {
      // Free models of one account share one quota; a paid model has its own.
      const quotaKey = provider.id + ":" + (model.endsWith(":free") ? "free" : model);
      const blocked = providerBlock(quotaKey);
      if (blocked) {
        if (!attempts.some((a) => a.quota && a.provider === provider.id)) {
          attempts.push({ provider: provider.id, model, ok: false, quota: true, message: provider.label + (blocked.daily ? ": daily free limit reached, skipped until it resets." : ": rate limit, skipped for a minute.") });
        }
        continue;
      }
      const remaining = options.deadlineAt - Date.now() - 1500;
      const timeoutMs = Math.min(options.perCallTimeoutMs, remaining);
      if (timeoutMs < 4000) {
        attempts.push({ provider: provider.id, model, ok: false, message: provider.label + ": not enough time left for AI verification." });
        break;
      }
      const release = provider.id === "gemini" ? await acquireSlot(provider.id, 2, options.deadlineAt) : () => {};
      try {
        let { response, raw } = await call(provider, model, timeoutMs, true);
        // A per-minute limit on Gemini/Groq (the last fallbacks): wait as asked and try once
        // more while there is time. OpenRouter moves straight on to the next provider.
        if (response.status === 429 && provider.id !== "openrouter" && !isDailyQuotaMessage(JSON.stringify(raw || ""))) {
          const wait = retryDelayMs(response.headers.get("retry-after"), raw);
          const left = options.deadlineAt - Date.now() - 1500 - wait;
          if (left >= 6000) {
            console.warn("[ai] " + provider.label + " " + model + " rate limit, retrying in " + Math.round(wait / 1000) + "s");
            await new Promise((r) => setTimeout(r, wait));
            ({ response, raw } = await call(provider, model, Math.min(timeoutMs, left), true));
          }
        }
        const errText = String(raw?.error?.message || raw?.error || "");
        if (!response.ok && (response.status === 400 || response.status === 404 || response.status === 422) && /response_format|json|structured|parameter/i.test(errText)) {
          ({ response, raw } = await call(provider, model, Math.min(timeoutMs, options.deadlineAt - Date.now() - 1500), false));
        }
        if (!response.ok || raw?.error) {
          const message = provider.label + " " + model + " HTTP " + response.status + ": " + String(raw?.error?.message || raw?.error?.metadata?.raw || "request failed").slice(0, 240);
          console.warn("[ai] " + message);
          if (response.status === 429) {
            // The limit is per account, not per model: stop this provider, go to the next one.
            const daily = isDailyQuotaMessage(JSON.stringify(raw || ""));
            blockProvider(quotaKey, daily);
            attempts.push({ provider: provider.id, model, ok: false, quota: true, message });
            break;
          }
          attempts.push({ provider: provider.id, model, ok: false, message });
          markModel(model, false);
          continue;
        }
        try {
          const parsed = parseJsonLoose(extractText(raw));
          attempts.push({ provider: provider.id, model: String(raw?.model || model), ok: true });
          markModel(model, true);
          return { parsed, usage: raw?.usage || null, provider: provider.id, model: String(raw?.model || model), attempts, error: "" };
        } catch {
          const finish = String(raw?.choices?.[0]?.finish_reason || "");
          const snippet = extractText(raw).replace(/\s+/g, " ").slice(0, 200);
          const message = provider.label + " " + String(raw?.model || model) + " returned text that is not valid JSON" + (finish ? " (finish_reason " + finish + ")" : "") + (snippet ? ": " + snippet : ": empty answer") + ".";
          console.warn("[ai] " + message);
          attempts.push({ provider: provider.id, model, ok: false, message });
          markModel(model, false);
        }
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        const message = timeout
          ? provider.label + " " + model + ": no answer within " + Math.round(timeoutMs / 1000) + "s."
          : provider.label + " " + model + " request failed: " + (error instanceof Error ? error.message : "network error");
        console.warn("[ai] " + message);
        attempts.push({ provider: provider.id, model, ok: false, message });
      } finally {
        release();
      }
    }
  }
  const quotaExhausted = attempts.some((a) => a.quota);
  const error = attempts.filter((a) => a.message).map((a) => a.message).join(" ") + " Candidates are shown for manual review.";
  return { parsed: null, usage: null, attempts, error, quotaExhausted };
}
