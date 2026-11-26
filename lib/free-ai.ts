// Chat-completion providers for structured extraction, tried in order until one
// answers. Every provider here has a free tier; Pro can point OpenRouter at a
// stronger paid model with PRO_OPENROUTER_MODEL.

export type AiProviderId = "openrouter" | "gemini" | "groq" | "github" | "deepseek" | "cerebras" | "mistral";
export type Edition = "free" | "pro";

type AiProvider = { id: AiProviderId; label: string; endpoint: string; key: string; model: string; models?: string[]; headers?: Record<string, string> };

// Free OpenRouter model IDs come and go. When OPENROUTER_MODEL is not set, the current
// free models are read from OpenRouter's public model list and the best few are tried in
// turn. These IDs are only the fallback when that list cannot be fetched.
export const FALLBACK_FREE_MODELS = [
  "deepseek/deepseek-chat-v3-0324:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
];
const PREFERRED_FREE = [/deepseek-(chat|v3)/i, /nemotron.*super/i, /gemma-4-31b/i, /llama-3\.3-70b/i, /gemini.*flash/i, /qwen.*(72b|235b|max)/i, /llama-4/i, /mistral-(small|medium)/i, /gpt-oss/i];
let freeModelCache: { at: number; models: string[] } | null = null;

// Only text-in/text-out chat models that support JSON output are usable; music, image,
// audio and embedding models (e.g. Lyria) are never picked even when listed as free.
const NOT_CHAT = /lyria|image|imagen|audio|music|tts|whisper|speech|veo|video|embed|rerank|guard|moderation|vision-only|omni/i;
// Tiny models (1-9B, nano/lightning) truncate or garble the verification JSON.
const TOO_SMALL = /[-_](?:[0-9](?:\.\d+)?b)\b|nano|lightning/i;
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
    return id && isFree && textOnlyOut && textIn && json && !NOT_CHAT.test(id) && !TOO_SMALL.test(id) && Number(m?.context_length || 0) >= 16000;
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

export function resetFreeModelCache() { freeModelCache = null; modelHealth.clear(); }

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

// Order matters: fast, reliable free tiers first (Groq answers in ~2 s), OpenRouter's shared
// free pool (often 429) last. Each provider has a few models; a 404/429 moves to the next one.
// Groq, GitHub Models, Cerebras and Mistral keys only bill if the account is upgraded, so they
// are allowed in ZERO_COST_MODE too.
export function configuredAiProviders(edition: Edition = "free"): AiProvider[] {
  const out: AiProvider[] = [];
  const env = (name: string) => String(process.env[name] || "").trim();
  const list = (...ids: string[]) => [...new Set(ids.filter(Boolean))];
  const zeroCost = env("ZERO_COST_MODE") === "on";

  // Paid DeepSeek through the existing OpenRouter key (~$0.09/$0.18 per 1M tokens), first in line;
  // GPT-4o mini (~$0.15/$0.60) on the same key is its paid backup.
  // Explicit owner opt-in only (OPENROUTER_DEEPSEEK=on), so ZERO_COST_MODE never bills by accident.
  if (env("OPENROUTER_API_KEY") && env("OPENROUTER_DEEPSEEK") === "on") {
    const models = list(env("DEEPSEEK_MODEL") || "deepseek/deepseek-v4-flash", env("GPT_BACKUP_MODEL") || "openai/gpt-4o-mini");
    out.push({ id: "deepseek", label: "DeepSeek / GPT (OpenRouter)", endpoint: "https://openrouter.ai/api/v1/chat/completions", key: env("OPENROUTER_API_KEY"), model: models[0], models,
      headers: { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://universal-ai-search-agent-demo.vercel.app", "X-Title": "Aurelius Universal AI Research Engine" } });
  }

  if (env("GROQ_API_KEY")) {
    const models = list(env("GROQ_MODEL") || "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct");
    out.push({ id: "groq", label: "Groq", endpoint: "https://api.groq.com/openai/v1/chat/completions", key: env("GROQ_API_KEY"), model: models[0], models });
  }

  // A Google AI Studio key without billing only has the free tier; ZERO_COST_GEMINI=off drops it.
  const geminiKey = env("GEMINI_API_KEY") || env("GOOGLE_AI_API_KEY");
  if (geminiKey && !(zeroCost && env("ZERO_COST_GEMINI") === "off")) {
    const models = list((edition === "pro" && env("PRO_GEMINI_MODEL")) || env("GEMINI_MODEL") || "gemini-2.5-flash", "gemini-flash-lite-latest");
    out.push({ id: "gemini", label: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: geminiKey, model: models[0], models });
  }

  // DeepSeek for free: GitHub Models serves DeepSeek-V3 on any GitHub account (token with models:read).
  // DeepSeek's own API has no free tier.
  const githubToken = env("GITHUB_MODELS_TOKEN");
  if (githubToken) {
    const models = list(env("GITHUB_MODELS_MODEL") || "deepseek/DeepSeek-V3-0324", "openai/gpt-4.1-mini");
    out.push({ id: "github", label: "GitHub Models", endpoint: "https://models.github.ai/inference/chat/completions", key: githubToken, model: models[0], models });
  }
  if (env("CEREBRAS_API_KEY")) {
    const models = list(env("CEREBRAS_MODEL") || "gpt-oss-120b", "llama-3.3-70b");
    out.push({ id: "cerebras", label: "Cerebras", endpoint: "https://api.cerebras.ai/v1/chat/completions", key: env("CEREBRAS_API_KEY"), model: models[0], models });
  }
  if (env("MISTRAL_API_KEY")) {
    const models = list(env("MISTRAL_MODEL") || "mistral-small-latest");
    out.push({ id: "mistral", label: "Mistral", endpoint: "https://api.mistral.ai/v1/chat/completions", key: env("MISTRAL_API_KEY"), model: models[0], models });
  }

  const openRouterKey = env("OPENROUTER_API_KEY");
  if (openRouterKey) {
    const requested = String((edition === "pro" && process.env.PRO_OPENROUTER_MODEL) || process.env.OPENROUTER_MODEL || "").trim();
    // Strict zero-cost mode never lets OpenRouter pick a model that could become billable.
    const freeOnlyModel = requested === "openrouter/free" || requested.endsWith(":free") ? requested : "openrouter/free";
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

export type AiAttempt = { provider: AiProviderId; model: string; ok: boolean; message?: string };
export type AiExtraction = { parsed: any | null; usage: any; provider?: AiProviderId; model?: string; attempts: AiAttempt[]; error: string };

// Tries each configured provider until one returns valid JSON or the time budget runs out.
export async function runStructuredExtraction(options: {
  system: string;
  user: string;
  schema: unknown;
  edition?: Edition;
  deadlineAt: number;
  maxTokens: number;
  perCallTimeoutMs: number;
  // Provider to try first (e.g. Gemini for short structured tasks the free OpenRouter models often truncate).
  prefer?: AiProviderId;
}): Promise<AiExtraction> {
  const providers = configuredAiProviders(options.edition || "free").sort((a, b) => Number(b.id === options.prefer) - Number(a.id === options.prefer));
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
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text().catch(() => "");
    let raw: any = null;
    try { raw = JSON.parse(body); } catch { /* not JSON: kept as text for the error message */ }
    return { response, raw, body };
  }

  for (const provider of providers) {
    // OpenRouter: the configured model first, then current free models as a fallback.
    const models = provider.id !== "openrouter"
      ? orderByHealth(provider.models || [provider.model])
      : [...new Set([...(provider.model === "auto-free" ? [] : [provider.model]), ...orderByHealth(await freeOpenRouterModels())])];
    // OpenRouter's free pool is the last resort: at most 3 models so it cannot eat the whole budget.
    for (const model of models.slice(0, provider.id === "openrouter" ? 3 : 4)) {
      const remaining = options.deadlineAt - Date.now() - 1500;
      const timeoutMs = Math.min(options.perCallTimeoutMs, remaining);
      if (timeoutMs < 4000) {
        attempts.push({ provider: provider.id, model, ok: false, message: provider.label + ": not enough time left for AI verification." });
        return { parsed: null, usage: null, attempts, error: attempts.filter((a) => a.message).map((a) => a.message).join(" ") + " Candidates are shown for manual review." };
      }
      try {
        let { response, raw, body } = await call(provider, model, timeoutMs, true);
        const errText = String(raw?.error?.message || raw?.error || "");
        if (!response.ok && (response.status === 400 || response.status === 404 || response.status === 422) && /response_format|json|structured|parameter/i.test(errText)) {
          ({ response, raw, body } = await call(provider, model, Math.min(timeoutMs, options.deadlineAt - Date.now() - 1500), false));
        }
        if (!response.ok || raw?.error) {
          const message = provider.label + " " + model + " HTTP " + response.status + ": " + String(raw?.error?.message || raw?.error?.metadata?.raw || "request failed").slice(0, 240);
          console.warn("[ai] " + message);
          attempts.push({ provider: provider.id, model, ok: false, message });
          if (response.status !== 429) markModel(model, false);
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
          const message = provider.label + " " + String(raw?.model || model) + " returned text that is not valid JSON" + (finish ? " (finish_reason " + finish + ")" : "") + (snippet ? ": " + snippet : ": empty answer (HTTP " + response.status + ", " + (response.headers.get("content-type") || "no content-type") + ", body: " + body.replace(/\s+/g, " ").slice(0, 160) + ")") + ".";
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
      }
    }
  }
  const error = attempts.filter((a) => a.message).map((a) => a.message).join(" ") + " Candidates are shown for manual review.";
  return { parsed: null, usage: null, attempts, error };
}
